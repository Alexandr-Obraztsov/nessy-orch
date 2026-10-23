import { AppError } from '../../domain/errors'
import type { JobKind, JobView } from '../../../shared/types'
import type { IdGenerator } from '../ports'
import type { EnqueueOpts, JobState } from './learning.types'

/** Сколько завершённых заданий (`done`/`error`) хранится. */
const KEEP_FINISHED = 200

/**
 * Состояния задания (`JobStatus`) в работе: только `queued` и `running`; `done` — завершено или снято (`error` в типе остался для старых файлов).
 *
 * | из        | в        | когда                                                                                | метод        |
 * |-----------|----------|--------------------------------------------------------------------------------------|--------------|
 * | (новое)   | queued   | постановка (FIFO, одно ждущее задание на объект)                                      | `enqueue`    |
 * | queued    | running  | есть свободный слот, нет замка (`isWaiting`) и нет running с тем же объектом          | `start`      |
 * | running   | done     | обработчик закончил                                                                  | `finish`     |
 * | running   | running  | провал попытки: попытка++, `error`; слот остаётся за заданием, повтор — по таймеру сервиса | `fail`  |
 * | running   | queued   | остановка сервиса / рестарт: попытка не тратится                                      | `requeue`, `load` |
 * | queued/running | done | остановлено пользователем (`note`), повторов нет                                | `cancel`     |
 * | error     | queued   | ручной повтор старого упавшего задания (файлы прежних версий)                         | `retry`      |
 *
 * Замок (правка кейса/плейбука, идущее задание того же объекта) — не состояние: такое задание остаётся `queued`.
 * Готовое к запуску задание ждёт только слот и запускается сразу, как слот освободится (сервис качает очередь синхронно).
 */

/**
 * Очередь заданий обучения в памяти: порядок постановки, дедупликация, повторы.
 * Ничего не пишет на диск и не публикует: после каждого изменения
 * вызывающий (сервис) сохраняет `list()` и рассылает событие.
 */
export class JobQueue {
	private jobs: JobState[] = []
	/** как сводить `payload` ждущих заданий объекта (запоминается при постановке с `merge`) */
	private readonly absorbed: JobState[] = []
	private readonly mergers = new Map<string, NonNullable<EnqueueOpts['merge']>>()

	constructor(private readonly deps: { ids: IdGenerator; now: () => number }) {}

	/** Загрузка с диска: прерванные перезапуском `running` возвращаются в очередь. */
	load(jobs: JobState[]): void {
		this.jobs = jobs.map(j => {
			// поле `retryAt` прежних версий не нужно
			const { retryAt: _retryAt, ...rest } = j as JobState & { retryAt?: unknown }
			return rest.status === 'running' ? { ...rest, status: 'queued' as const, note: 'прервано перезапуском', startedAt: null, activityAt: null, agentId: null } : rest
		})
		// после рестарта вернувшееся в очередь могло оказаться рядом с уже ждущим заданием того же объекта
		for (const j of [...this.jobs]) if (j.status === 'queued') this.absorb(j)
	}

	/**
	 * Постановка: у объекта (`subject`) уже есть `queued` — дополняем его, иначе новое в конец.
	 * `merge` сводит `payload` ждущего задания с новым (нет `merge` — берётся новый, если он задан).
	 */
	enqueue(kind: JobKind, subject: string, opts: EnqueueOpts = {}): JobState {
		const final = opts.final ?? false
		const payload = opts.payload ?? null
		if (opts.merge) this.mergers.set(subject, opts.merge)
		const queued = this.jobs.find(j => j.subject === subject && j.status === 'queued')
		if (queued) {
			queued.final = queued.final || final
			if (kind === 'close') queued.kind = 'close'
			if (opts.merge) queued.payload = opts.merge(queued.payload, payload)
			else if (payload !== null) queued.payload = payload
			return queued
		}
		const job: JobState = {
			id: `j-${this.deps.ids.next(8)}`,
			kind,
			caseId: opts.caseId ?? '',
			subject,
			status: 'queued',
			attempts: 0,
			agentId: null,
			error: null,
			note: null,
			range: null,
			title: null,
			createdAt: new Date(this.deps.now()).toISOString(),
			startedAt: null,
			finishedAt: null,
			final,
			payload,
		}
		this.jobs.push(job)
		return job
	}

	/**
	 * Первое по порядку (FIFO) `queued`, которое можно запускать: у объекта нет `running`,
	 * `isWaiting` не просит подождать (замок: правка, плейбук; кейсы из `payload.after` ещё не готовы).
	 */
	next(isWaiting?: (job: JobState) => boolean): JobState | null {
		const busy = new Set(this.jobs.filter(j => j.status === 'running').map(j => j.subject))
		return this.jobs.find(j => j.status === 'queued' && !busy.has(j.subject) && !(isWaiting?.(j) ?? false)) ?? null
	}

	start(id: string, agentId: string | null): JobState {
		const j = this.get(id)
		j.status = 'running'
		j.agentId = agentId
		j.startedAt = this.iso()
		j.activityAt = this.deps.now()
		return j
	}

	/** Отметка активности идущего задания (сторожевой таймер); нет такого running — false. */
	touch(id: string): boolean {
		const j = this.jobs.find(x => x.id === id && x.status === 'running')
		if (!j) return false
		j.activityAt = this.deps.now()
		return true
	}

	finish(id: string): JobState {
		const j = this.get(id)
		j.status = 'done'
		j.finishedAt = this.iso()
		this.prune()
		return j
	}

	/**
	 * Провал попытки: задание остаётся `running` (слот за ним), попытка++, `error` хранит причину.
	 * Повтор назначает сервис таймером `retrySec`; прогресс (принятые чекпоинты) в кейсе сохраняется.
	 */
	fail(id: string, error: string): JobState {
		const j = this.get(id)
		j.attempts++
		j.error = error
		return j
	}

	/**
	 * Задание вернулось в `queued`, а у объекта уже ждёт другое (поставили, пока это шло): остаётся одно.
	 * Сводятся `final`, вид (`close` сильнее), `payload`; ждать нужно не дольше более раннего срока.
	 */
	private absorb(j: JobState): JobState {
		const other = this.jobs.find(x => x !== j && x.status === 'queued' && x.subject === j.subject)
		if (!other) return j
		j.final = j.final || other.final
		if (other.kind === 'close') j.kind = 'close'
		const merge = this.mergers.get(j.subject)
		j.payload = merge ? merge(j.payload, other.payload) : (other.payload ?? j.payload)
		// поглощённое не исчезает из списка: завершается с пометкой, а сервис публикует это изменение (`takeAbsorbed`)
		other.status = 'done'
		other.note = `объединено с ${j.id}`
		other.finishedAt = this.iso()
		this.absorbed.push(other)
		return j
	}

	/** Задания, поглощённые при возврате другого в очередь, — один раз: сервис публикует их изменение. */
	takeAbsorbed(): JobState[] {
		return this.absorbed.splice(0)
	}

	/** Остановлено пользователем: задание завершается (`done`) с пометкой, повторов нет. */
	cancel(id: string, note: string): JobState {
		const j = this.get(id)
		j.note = note
		return this.finish(id)
	}

	/** Прервано остановкой сервиса: снова в очередь, попытка не тратится. */
	requeue(id: string, note: string): JobState {
		const j = this.get(id)
		j.status = 'queued'
		j.startedAt = null
		j.activityAt = null
		j.note = note
		return this.absorb(j)
	}

	/** Ручной повтор упавшего задания. */
	retry(id: string): JobState {
		const j = this.get(id)
		if (j.status !== 'error') throw new AppError(409, 'job_not_failed', `задание ${id} не в ошибке`)
		j.status = 'queued'
		j.attempts = 0
		j.error = null
		j.startedAt = null
		j.finishedAt = null
		return j
	}

	/** Кейс удалён: убираем его ждущие и упавшие задания. */
	removeCase(caseId: string): void {
		this.jobs = this.jobs.filter(j => (j.subject !== caseId && j.caseId !== caseId) || (j.status !== 'queued' && j.status !== 'error'))
	}

	hasJob(subject: string): boolean {
		return this.jobs.some(j => j.subject === subject && (j.status === 'queued' || j.status === 'running'))
	}

	running(): JobState[] {
		return this.jobs.filter(j => j.status === 'running')
	}

	/** Активные и последние завершённые, в порядке постановки. */
	list(): JobState[] {
		return [...this.jobs]
	}

	/** Вид без служебных полей; `progress` считает сервис (нужны события кейса). */
	toView(j: JobState, progress: JobView['progress'] = null): JobView {
		const { final: _final, payload: _payload, activityAt: _activityAt, title, ...view } = j
		return { ...view, title: title ?? null, progress }
	}

	private get(id: string): JobState {
		const j = this.jobs.find(x => x.id === id)
		if (!j) throw new AppError(404, 'no_job', `нет задания ${id}`)
		return j
	}

	private iso(): string {
		return new Date(this.deps.now()).toISOString()
	}

	/** Оставляет только последние `KEEP_FINISHED` завершённых. */
	private prune(): void {
		let extra = this.jobs.filter(j => j.status === 'done' || j.status === 'error').length - KEEP_FINISHED
		if (extra <= 0) return
		this.jobs = this.jobs.filter(j => {
			if (extra > 0 && (j.status === 'done' || j.status === 'error')) {
				extra--
				return false
			}
			return true
		})
	}
}
