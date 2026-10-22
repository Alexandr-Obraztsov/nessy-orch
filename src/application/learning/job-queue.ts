import { AppError } from '../../domain/errors'
import type { JobKind, JobView } from '../../../shared/types'
import type { IdGenerator } from '../ports'
import type { EnqueueOpts, JobState } from './learning.types'

/** Сколько завершённых заданий (`done`/`error`) хранится. */
const KEEP_FINISHED = 200

/**
 * Очередь заданий обучения в памяти: порядок постановки, дедупликация, повторы.
 * Ничего не пишет на диск и не публикует: после каждого изменения
 * вызывающий (сервис) сохраняет `list()` и рассылает событие.
 */
export class JobQueue {
	private jobs: JobState[] = []

	constructor(private readonly deps: { ids: IdGenerator; now: () => number }) {}

	/** Загрузка с диска: прерванные перезапуском `running` возвращаются в очередь. */
	load(jobs: JobState[]): void {
		this.jobs = jobs.map(j => (j.status === 'running' ? { ...j, status: 'queued', note: 'прервано перезапуском', startedAt: null } : { ...j }))
	}

	/**
	 * Постановка: у объекта (`subject`) уже есть `queued` — дополняем его, иначе новое в конец.
	 * `merge` сводит `payload` ждущего задания с новым (нет `merge` — берётся новый, если он задан).
	 */
	enqueue(kind: JobKind, subject: string, opts: EnqueueOpts = {}): JobState {
		const final = opts.final ?? false
		const payload = opts.payload ?? null
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
			readUntil: null,
			createdAt: new Date(this.deps.now()).toISOString(),
			startedAt: null,
			finishedAt: null,
			final,
			retryAt: opts.delayMs ? this.deps.now() + opts.delayMs : null,
			payload,
		}
		this.jobs.push(job)
		return job
	}

	/**
	 * Первое готовое к запуску `queued`: срок повтора наступил, у объекта нет `running`,
	 * `isWaiting` не просит подождать (например, кейсы из `payload.after` ещё не готовы).
	 */
	next(now: number, isWaiting?: (job: JobState) => boolean): JobState | null {
		const busy = new Set(this.jobs.filter(j => j.status === 'running').map(j => j.subject))
		return this.jobs.find(j => j.status === 'queued' && (j.retryAt === null || j.retryAt <= now) && !busy.has(j.subject) && !(isWaiting?.(j) ?? false)) ?? null
	}

	start(id: string, agentId: string | null): JobState {
		const j = this.get(id)
		j.status = 'running'
		j.agentId = agentId
		j.startedAt = this.iso()
		j.retryAt = null
		j.readUntil = null
		return j
	}

	finish(id: string): JobState {
		const j = this.get(id)
		j.status = 'done'
		j.finishedAt = this.iso()
		this.prune()
		return j
	}

	/**
	 * Провал: задание всегда возвращается в очередь (ошибок для человека нет, повторы бесконечные)
	 * с паузой `min(pauseMs * попытка, maxPauseMs)`; `error` хранит последнюю ошибку.
	 */
	fail(id: string, error: string, pauseMs = 30_000, maxPauseMs = 600_000): JobState {
		const j = this.get(id)
		j.attempts++
		j.error = error
		j.status = 'queued'
		j.startedAt = null
		j.retryAt = this.deps.now() + Math.min(pauseMs * j.attempts, maxPauseMs)
		return j
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
		j.retryAt = null
		j.note = note
		return j
	}

	/** Ручной повтор упавшего задания. */
	retry(id: string): JobState {
		const j = this.get(id)
		if (j.status !== 'error') throw new AppError(409, 'job_not_failed', `задание ${id} не в ошибке`)
		j.status = 'queued'
		j.attempts = 0
		j.retryAt = null
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
		const { final: _final, retryAt: _retryAt, payload: _payload, readUntil: _readUntil, title, ...view } = j
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
