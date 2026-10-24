import type {
	CaseDraftResult,
	CaseImpact,
	LearningCards,
	CaseReadBlock,
	ChatMessage,
	JobDetail,
	JournalEntry,
	PlaybookDetail,
	PlaybookStatus,
	PlaybookView,
} from '../../../shared/types'
import type { CaseDetail, CaseView, JobKind, JobView, LearningSettings, LearningSignal, LearningView, RawEvent, SessionView } from '../../../shared/types'
import { createHash } from 'node:crypto'
import { caseCard, playbookCard } from '../../domain/cards'
import { AppError } from '../../domain/errors'
import { parseSummaryHeads } from '../../domain/collector'
import { parseLearningSettings, patchLearningSettings } from '../../domain/learning-settings'
import { caseIdOf, chainOf, ingest } from './case-ingest'
import { onCaseReady } from './case-ready'
import { absorbHandler } from './absorb.handler'
import { buildHandler, groupHash } from './build.handler'
import { collectHandler } from './collect.handler'
import { editHandler, mergeEditPayload } from './edit.handler'
import { foldHandler } from './fold.handler'
import { improveHandler } from './improve.handler'
import { judgeHandler } from './judge.handler'
import { matchHandler } from './match.handler'
import { approvePlaybook, meanCorrections, rejectPlaybook, reviewHandler } from './review.handler'
import { verifyHandler } from './verify.handler'
import type { HintHost, JobContext, JobHandler } from './handlers.types'
import { JobQueue } from './job-queue'
import { PlaybookService, playbookView } from './playbook.service'
import { ReadProtocol, protocolPhase, protocolProgress } from './read-protocol'
import type { CaseState, EnqueueOpts, FailedBuild, FoldRef, JobState, LearningDeps, LearningMeta, LogLevel, TranscriptCursor } from './learning.types'
import { recount } from '../../domain/rule-counters'
import { payloadStr } from './payload'

/** Сколько после окончательного провала сборки `match` не повторяет ту же группу. */
const FAILED_BUILD_MS = 24 * 3600 * 1000
/** Сколько событий отдаёт `GET /learning/cases/:id/raw`. */
const RAW_LIMIT = 500
/** Как часто пересчитываются счётчики правил (затухание). */
const RECOUNT_MS = 24 * 3600 * 1000
/** Пометка остановленного пользователем задания. */
const CANCELLED = 'остановлено'

/** sha1 (hex) описания кейса: по нему клиент и сервер сверяют, что правили то же самое. */
export const summaryHash = (text: string): string => createHash('sha1').update(text, 'utf8').digest('hex')

/** Длительность для человека: «45 с», «2 мин 10 с», «1 ч 5 мин». */
export function fmtDuration(ms: number): string {
	const sec = Math.max(0, Math.round(ms / 1000))
	if (sec < 60) return `${sec} с`
	const min = Math.floor(sec / 60)
	if (min < 60) return sec % 60 ? `${min} мин ${sec % 60} с` : `${min} мин`
	return min % 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${Math.floor(min / 60)} ч`
}

/** Русское множественное число: 1 событие, 2 события, 5 событий. */
const plural = (n: number, one: string, few: string, many: string): string => {
	const m10 = n % 10
	const m100 = n % 100
	if (m10 === 1 && m100 !== 11) return one
	return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

const toView = (c: CaseState): CaseView => ({
	id: c.id,
	title: c.title,
	sessions: c.sessions,
	status: c.status,
	goals: c.goals,
	events: c.events,
	coveredUntil: c.coveredUntil,
	createdAt: c.createdAt,
	updatedAt: c.updatedAt,
	closedAt: c.closedAt,
	playbook: c.playbook,
	...(c.foldedGoals ? { foldedGoals: c.foldedGoals } : {}),
	source: 'live',
})

/** Фоновое обучение: сессии, законченные хуком `SessionEnd`, закрытием вкладки или простоем `idleMin`, собираются в кейсы; кейсам назначаются задания (очередь `queued`/`running`, без опроса). */
export class LearningService {
	private readonly cases = new Map<string, CaseState>()
	private settings: LearningSettings
	private settingsMtime = -1
	private loaded = false
	private readonly queue: JobQueue
	/** протокол чтения сборщика (создаётся при первом обращении) */
	private readProtocol: ReadProtocol | null = null
	private stopped = false
	private pumping = false
	/** единственный таймер срока простоя: ближайший `lastActivityAt + idleMin` среди открытых кейсов */
	private idleTimer: NodeJS.Timeout | null = null
	/** сторожевой таймер: ближайший срок молчания агента (только при `stallMin > 0`) */
	private stallTimer: NodeJS.Timeout | null = null
	/** повторы заданий после ошибки: одноразовый таймер на задание */
	private readonly retryTimers = new Map<string, NodeJS.Timeout>()
	/** задания `running`, у которых попытка провалилась и ждёт повтора (слот за ними) */
	private readonly failed = new Set<string>()
	/** повтор сбора событий законченной сессии, когда диск не принял запись: кейс → таймер */
	private readonly ingestRetry = new Map<string, NodeJS.Timeout>()
	/** сколько агентов вызвано в задании (имена файлов `runs/`) */
	private readonly runCalls = new Map<string, number>()
	/** поколение запуска задания: сторож или остановка меняют его, и поздние итоги прежнего запуска игнорируются */
	private readonly runGen = new Map<string, number>()
	private genSeq = 0
	/** идущие исполнения заданий: `stop()` ждёт их */
	private readonly inflight = new Set<Promise<void>>()
	/** задания, прерванные `stop()`: их поздние итоги игнорируются */
	private readonly interrupted = new Set<string>()
	/** задания, остановленные пользователем: обработчик получает отмену, итог игнорируется */
	private readonly cancelled = new Set<string>()
	private meta: LearningMeta = { startedAt: 0, startSeq: 0, removed: [] }
	/** обработчики заданий по виду */
	private readonly handlers = new Map<JobKind, JobHandler>()
	/** плейбуки; null без `deps.playbookStore` — тогда сервис работает как на этапе 1 */
	readonly playbooks: PlaybookService | null
	/** подсказка плейбука (хук UserPromptSubmit, сборщик); не сам сервис: имя `playbooks` занято полем */
	readonly hints: HintHost = {
		playbooks: () => this.playbooks?.list() ?? [],
		caseOf: session => this.caseOfSession(session),
		markHinted: (session, id) => this.markHinted(session, id),
		hintedOf: session => [...(this.memHinted.get(session) ?? [])],
		queueHint: (caseId, id) => {
			const q = this.hintQueue.get(caseId) ?? []
			if (!q.includes(id)) this.hintQueue.set(caseId, [...q, id])
		},
		takeQueued: session => {
			const c = this.caseOfSession(session)
			const q = c ? this.hintQueue.get(c.id) : undefined
			const id = q?.shift() ?? null
			if (c && q && !q.length) this.hintQueue.delete(c.id)
			return id
		},
	}
	/** очередь подсказок сборщика по кейсу (в памяти) */
	private readonly hintQueue = new Map<string, string[]>()
	/** подсказанное сессиям без кейса (в памяти) */
	private readonly memHinted = new Map<string, Set<string>>()

	constructor(private readonly deps: LearningDeps) {
		this.settings = parseLearningSettings({ enabled: deps.defaultOn })
		this.queue = new JobQueue({ ids: deps.ids, now: () => deps.clock.now() })
		this.playbooks = deps.playbookStore
			? new PlaybookService({
					store: deps.playbookStore,
					hub: deps.hub,
					clock: deps.clock,
					ids: deps.ids,
					...(deps.pluginVersion ? { pluginVersion: deps.pluginVersion } : {}),
					caseOf: id => this.cases.get(id) ?? null,
					onFolds: (id, refs) => this.enqueueFolds(id, refs),
				})
			: null
		this.registerHandler(collectHandler)
		// обработчики плейбуков — только при хранилище плейбуков
		if (this.playbooks)
			for (const h of [matchHandler, verifyHandler, buildHandler, absorbHandler, foldHandler, reviewHandler, judgeHandler, improveHandler, editHandler])
				this.registerHandler(h)
	}

	/** Регистрирует обработчик заданий своих видов (повторная регистрация заменяет прежний). */
	registerHandler(h: JobHandler): void {
		for (const k of h.kinds) this.handlers.set(k, h)
	}

	load(): void {
		this.cases.clear()
		this.playbooks?.load()
		for (const c of this.deps.store.loadCases()) {
			// событий за `nextN` быть не может: хвост оборванного сбора отрезается
			this.deps.store.truncateRaw(c.id, c.nextN)
			// миграция: нет `lastActivityAt` — последняя работа сессии = последнее событие или обновление кейса
			const withRoot = c.rootId === undefined ? { ...c, rootId: c.sessions[0] ?? c.id } : c
			this.cases.set(
				c.id,
				withRoot.lastActivityAt === undefined ? { ...withRoot, lastActivityAt: Math.max(withRoot.lastEventAt, Date.parse(withRoot.updatedAt) || 0) } : withRoot,
			)
		}
		// точка отсчёта: сессии, созданные до первого запуска, живых кейсов не заводят (только разбор прошлого)
		const meta = this.deps.store.loadMeta()
		if (meta) this.meta = meta
		else {
			this.meta = { startedAt: this.deps.clock.now(), startSeq: this.deps.host.lastSeq(), removed: [] }
			this.deps.store.saveMeta(this.meta)
		}
		const jobs = this.deps.store.loadJobs()
		this.queue.load(jobs)
		for (const j of jobs) {
			if (j.status !== 'running') continue
			this.log('warn', j.subject, `${this.jobLabel(j)}: прервано перезапуском, продолжаю`)
			// агент прежнего запуска не нужен: задание начнёт со свежим
			if (j.agentId) void this.deps.host.releaseAgent?.(j.agentId).catch(() => undefined)
		}
		// после рестарта `running` вернулись в очередь: фиксируем это на диске
		if (jobs.some(j => j.status === 'running')) this.deps.store.saveJobs(this.queue.list())
		this.readSettings()
		this.loaded = true
	}

	/**
	 * Запуск: один проход восстановления (кейс `closing` без задания — обратно в сбор, события открытых кейсов по курсорам в `raw/`),
	 * таймер срока простоя и насос. Периодических проверок нет.
	 */
	start(): void {
		this.stopped = false
		const pending = this.queue.list().filter(j => j.status === 'queued' || j.status === 'running').length
		this.log('info', '', `Фоновое обучение запущено: кейсов ${this.cases.size}, заданий в работе и очереди ${pending}`)
		for (const c of [...this.cases.values()]) {
			if (c.status === 'closing' && !this.hasJob(c.id)) this.reopenClosing(c.id)
			const open = this.cases.get(c.id)
			if (open?.status === 'collecting') this.ingestCase(open)
		}
		this.decay()
		this.purgeArchive()
		this.armIdle()
		this.armStall()
		this.pump()
	}

	/** Останавливает таймеры и приём заданий; идущих сборщиков ждёт не дольше 5 с (остальные вернутся в очередь при рестарте). */
	async stop(): Promise<void> {
		this.stopped = true
		this.log('info', '', 'Фоновое обучение остановлено')
		if (this.idleTimer) clearTimeout(this.idleTimer)
		if (this.stallTimer) clearTimeout(this.stallTimer)
		for (const t of this.retryTimers.values()) clearTimeout(t)
		for (const t of this.ingestRetry.values()) clearTimeout(t)
		this.ingestRetry.clear()
		this.idleTimer = null
		this.stallTimer = null
		this.retryTimers.clear()
		const waiting = [...this.failed]
		this.failed.clear()
		// задания, ждавшие повтора: исполнителя нет, сразу в очередь
		for (const id of waiting) {
			const j = this.queue.running().find(x => x.id === id)
			if (!j) continue
			this.releaseAgentOf(j)
			this.jobsChanged(this.queue.requeue(j.id, 'прервано остановкой'))
		}
		if (!this.inflight.size) return
		let timer: NodeJS.Timeout | undefined
		const limit = new Promise<void>(resolve => {
			timer = setTimeout(resolve, 5000)
			timer.unref()
		})
		await Promise.race([Promise.allSettled([...this.inflight]).then(() => undefined), limit])
		if (timer) clearTimeout(timer)
		// не дождались: задание возвращается в очередь без траты попытки
		const cut = this.queue.running()
		for (const j of cut) {
			this.interrupted.add(j.id)
			this.log('warn', j.subject, `${this.jobLabel(j)}: прервано остановкой, вернётся в очередь`)
			this.releaseAgentOf(j)
			this.jobsChanged(this.queue.requeue(j.id, 'прервано остановкой'))
		}
	}

	getSettings(): LearningSettings {
		return this.settings
	}

	view(): LearningView {
		const cases = [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toView)
		return {
			settings: this.settings,
			jobs: this.queue.list().map(j => this.jobView(j)),
			cases,
			playbooks: this.playbooks?.list().map(playbookView) ?? [],
			journal: this.playbooks?.journal(300) ?? [],
			rev: this.deps.hub.rev,
		}
	}

	getCase(id: string): CaseState {
		const c = this.cases.get(id)
		if (!c) throw new AppError(404, 'no_case', `кейс ${id} не найден`)
		return c
	}

	/** Задание и ответы его агентов (`runs/`) по порядку вызова. */
	jobDetail(id: string): JobDetail {
		const job = this.queue.list().find(j => j.id === id)
		if (!job) throw new AppError(404, 'no_job', `нет задания ${id}`)
		return { job: this.jobView(job), runs: this.deps.store.readRuns(job.subject, job.id) }
	}

	/** События кейса `from..to` (включительно), не больше `RAW_LIMIT`: якорь «открыть место в сессии». */
	caseRaw(id: string, from: number, to?: number): RawEvent[] {
		this.getCase(id)
		return this.deps.store.readRaw(id, from, to).slice(0, RAW_LIMIT)
	}

	/**
	 * Правка описания руками: `summary.md` целиком, курсор сборщика не трогается; пока по кейсу идёт задание — 409 `case_busy`.
	 * `base` — sha1 описания, против которого правили; не совпал с текущим — 409 `stale`.
	 * После записи название и цели кейса пересобираются из текста, `updatedAt` обновляется, публикуется `learning_case`.
	 */
	setCaseSummary(id: string, text: string, base: string): void {
		const c = this.getCase(id)
		this.assertIdle(id)
		if (summaryHash(this.deps.store.readSummary(id)) !== base) throw new AppError(409, 'stale', `описание кейса ${id} изменилось`)
		if (!this.writeSummaryLogged(id, text)) throw new AppError(500, 'write_failed', 'не удалось записать summary.md')
		const heads = parseSummaryHeads(text)
		const next: CaseState = { ...c, goals: heads.goals, updatedAt: new Date(this.deps.clock.now()).toISOString() }
		this.cases.set(id, next)
		this.deps.store.saveCase(next)
		this.deps.hub.publish({ t: 'learning_case', case: toView(next) })
	}

	/**
	 * Остановить сборщика кейса: отмена всех его `collect`/`close` (см. `cancelJob`).
	 * Кейс не запечатывается и не удаляется; `closing` возвращается в `collecting`.
	 */
	stopCollector(id: string): void {
		this.getCase(id)
		const jobs = this.queue
			.list()
			.filter(j => j.caseId === id && (j.kind === 'collect' || j.kind === 'close') && (j.status === 'queued' || j.status === 'running'))
		for (const j of jobs) this.cancelJob(j.id)
		this.reopenClosing(id)
	}

	/**
	 * Остановить задание любого вида: `queued` сразу `done` с пометкой, `running` — отмена агента;
	 * обработчик, получивший отмену, ничего не пишет, а задание завершается `done` с пометкой после его возврата, без повторов и `error`.
	 * Завершённое задание не меняется. Нет задания — 404 `no_job`.
	 */
	cancelJob(id: string): JobView {
		const job = this.queue.list().find(j => j.id === id)
		if (!job) throw new AppError(404, 'no_job', `нет задания ${id}`)
		if (job.status === 'queued') {
			this.log('info', job.subject, `${this.jobLabel(job)}: остановлено пользователем`)
			this.jobsChanged(this.queue.cancel(id, CANCELLED))
			this.reopenClosing(job.caseId)
			this.pump()
		} else if (job.status === 'running' && !this.cancelled.has(id)) {
			this.cancelled.add(id)
			this.log('info', job.subject, `${this.jobLabel(job)}: остановка по просьбе пользователя`)
			if (job.agentId) void this.deps.host.cancelAgent(job.agentId).catch(() => undefined)
			// попытки в ходу нет (ждёт повтора): снимаем сразу, некому вернуться из обработчика
			if (this.failed.has(id)) {
				this.finishCancelled(job)
				this.pump()
			}
		}
		return this.jobView(job)
	}

	/** Кейс в `closing`, у которого не осталось заданий сборки, возвращается в `collecting`. */
	private reopenClosing(caseId: string): void {
		const c = this.cases.get(caseId)
		if (!c || c.status !== 'closing') return
		if (
			this.queue.list().some(j => j.caseId === caseId && j.kind === 'close' && (j.status === 'queued' || j.status === 'running') && !this.cancelled.has(j.id))
		)
			return
		this.update({ ...c, status: 'collecting', closedAt: null, updatedAt: new Date(this.deps.clock.now()).toISOString() })
	}

	/** Правила плейбуков, у которых кейс среди доказательств; `evidenceLeft` — другие известные кейсы в их доказательствах. */
	caseImpact(id: string): CaseImpact {
		this.getCase(id)
		const rules: CaseImpact['rules'] = []
		for (const p of this.playbooks?.list() ?? []) {
			for (const r of p.rules) {
				if (r.status === 'archived' || !r.evidence.some(e => e.caseId === id)) continue
				const left = new Set(r.evidence.map(e => e.caseId).filter(c => c !== id && this.cases.has(c)))
				rules.push({ playbookId: p.id, ruleId: r.id, text: r.text, evidenceLeft: left.size })
			}
		}
		return { rules }
	}

	/**
	 * Сохранение документа плейбука (`PUT /learning/playbooks/:id/markdown`): замок плейбука — 409 `playbook_busy`,
	 * `baseVersion` не совпала — 409 `stale`, ошибки разбора и lint — 400 `lint`.
	 */
	putPlaybookMarkdown(id: string, text: string, baseVersion: number): PlaybookDetail {
		const ps = this.pb()
		ps.need(id)
		this.assertPlaybookIdle(id)
		ps.applyDocument(id, text, baseVersion, new Set(this.cases.keys()))
		return ps.detail(id)
	}

	/** Кейс с описанием, заметками и черновиком. */
	getCaseDetail(id: string): CaseDetail {
		const c = this.getCase(id)
		const summary = this.deps.store.readSummary(id)
		return {
			...toView(c),
			summary,
			summaryHash: summaryHash(summary),
			notes: this.deps.store.readNotes(id),
			draft: this.deps.store.readDraft(id),
			progress: this.progressOf(id),
		}
	}

	/**
	 * Строка журнала обучения (человеческий текст). Без хранилища плейбуков молча пропускается; сбой записи сервер не роняет.
	 * `subject` — id кейса или плейбука, у общих строк пусто.
	 */
	log(level: LogLevel, subject: string, text: string): void {
		if (!this.playbooks) return
		try {
			this.playbooks.record({ kind: 'log', level, subject, summary: text, report: null, revertible: false, revertedBy: null })
		} catch {
			/* журнал не должен ломать обучение */
		}
	}

	/** Название объекта для журнала: сессия кейса или заголовок плейбука (нет — id). */
	private nameOf(id: string): string {
		if (id.startsWith('c-')) return this.sessionTitle(id)
		return this.playbooks?.get(id)?.title || id
	}

	/** Что делает задание, словами: «Описание «X»», «Ревью плейбука «Y»»… */
	private jobLabel(j: JobState): string {
		const playbook = (): string => this.nameOf(this.playbookOfJob(j) ?? j.subject)
		switch (j.kind) {
			case 'collect':
				return `Описание «${this.nameOf(j.caseId)}»`
			case 'close':
				return `Итоговое описание «${this.nameOf(j.caseId)}»`
			case 'match':
				return 'Сопоставление сессий с плейбуками'
			case 'verify':
				return `Проверка группы «${payloadStr(j.payload, 'task')}»`
			case 'absorb':
				return `Вливание в плейбук «${playbook()}»`
			case 'fold':
				return `Свёртка цели «${payloadStr(j.payload, 'goal')}» из сессии «${this.nameOf(j.caseId)}»`
			case 'build':
				return 'Сборка плейбука'
			case 'review':
				return `Ревью плейбука «${playbook()}»`
			case 'judge':
				return `Судья по сессии «${this.nameOf(j.caseId)}»`
			case 'improve':
				return `Улучшение плейбука «${playbook()}»`
			case 'edit':
				return `Правка «${this.nameOf(j.subject.replace(/^edit:/, ''))}» по чату`
		}
	}

	/** Название сессии кейса: у цепочки последняя сессия, иначе заголовок кейса, иначе id. */
	private sessionTitle(caseId: string): string {
		const c = this.cases.get(caseId)
		if (!c) return caseId
		const last = c.sessions[c.sessions.length - 1]
		const found = last === undefined ? undefined : this.deps.host.sessions().find(x => x.id === last)
		return found?.title.trim() || c.title || caseId
	}

	/** Идущее задание сбора кейса (`collect`/`close`) или undefined. */
	private collecting(caseId: string): JobState | undefined {
		return this.queue.running().find(j => j.caseId === caseId && (j.kind === 'collect' || j.kind === 'close'))
	}

	/** Прогресс сбора: `read` — принятые события идущего задания, `total` — события к обработке на старте задания. */
	private progressOf(caseId: string): { read: number; total: number } | null {
		const job = this.collecting(caseId)
		return job ? protocolProgress(job) : null
	}

	private jobView(j: JobState): JobView {
		const collect = j.status === 'running' && (j.kind === 'collect' || j.kind === 'close')
		const phase = protocolPhase(j)
		const view: JobView & { protocol?: unknown } = { ...this.queue.toView(j, collect ? protocolProgress(j) : null), ...(phase !== undefined ? { phase } : {}) }
		// служебное состояние протокола наружу не отдаётся
		delete view.protocol
		return view
	}

	/**
	 * Активность идущего задания объекта (кейса `c-…`, плейбука и т. п.): сбрасывает сторожевой таймер.
	 * Зовут маршруты `read`/`draft` сборщика; нет идущего задания — ничего не делает.
	 */
	touchJob(subjectOrCaseId: string): void {
		for (const j of this.queue.running()) if (j.subject === subjectOrCaseId || j.caseId === subjectOrCaseId) this.queue.touch(j.id)
	}

	private writeSummaryLogged(id: string, text: string): boolean {
		const ok = this.deps.store.writeSummary(id, text)
		if (!ok) this.log('error', id, `«${this.sessionTitle(id)}»: не удалось записать описание на диск`)
		return ok
	}

	/** Строгий протокол чтения (`case read` / `case draft`). */
	private proto(): ReadProtocol {
		this.readProtocol ??= new ReadProtocol({
			getCase: id => this.getCase(id),
			collecting: id => this.collecting(id),
			readRaw: (id, from, to) => this.deps.store.readRaw(id, from, to),
			readSummary: id => this.deps.store.readSummary(id),
			writeSummary: (id, text) => this.writeSummaryLogged(id, text),
			writeDraft: (id, text) => this.deps.store.writeDraft(id, text),
			update: c => this.update(c),
			changed: job => this.jobsChanged(job),
			touch: id => this.touchJob(id),
			blockLimits: () => ({ events: this.settings.blockEvents, chars: this.settings.blockChars }),
			cancelAgent: agentId => void this.deps.host.cancelAgent(agentId).catch(() => undefined),
			now: () => this.deps.clock.now(),
			title: id => this.sessionTitle(id),
			log: (level, subject, text) => this.log(level, subject, text),
		})
		return this.readProtocol
	}

	/**
	 * Следующий блок событий кейса для агента-сборщика (≤ 25 событий и ≤ 12 000 знаков): пока описание выданного блока
	 * не принято — 409 `summary_required`; нет идущего задания — 409 `no_job`; все блоки приняты — `done`.
	 */
	caseRead(id: string): CaseReadBlock {
		return this.proto().read(id)
	}

	/** Агент — сборщик идущего задания кейса; иначе 403 `not_collector`. */
	assertCollector(caseId: string, agentId: string): void {
		this.getCase(caseId)
		if (this.collecting(caseId)?.agentId !== agentId) throw new AppError(403, 'not_collector', `агент ${agentId} не собирает кейс ${caseId}`)
	}

	/**
	 * Описание за выданный блок (`final` — итоговая консолидация после `done`) от агента-сборщика: проверки R1–R9,
	 * принято — `summary.md` и `coveredUntil` обновлены сразу; отказ — 422 `rejected` со всеми нарушениями.
	 */
	caseDraft(id: string, text: string, final = false): CaseDraftResult {
		return this.proto().draft(id, text, final)
	}

	// ---------- плейбуки, журнал, заметки и чат (API) ----------

	private pb(): PlaybookService {
		if (!this.playbooks) throw new AppError(503, 'playbooks_unavailable', 'плейбуки недоступны: нет хранилища')
		return this.playbooks
	}

	/** Карточки для обзора сопоставителя: кейсы `ready` (свежие первыми) и плейбуки. */
	cards(): LearningCards {
		const cases = [...this.cases.values()]
			.filter(c => c.status === 'ready')
			.sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt))
			.map(c => ({ id: c.id, card: caseCard({ title: this.sessionTitle(c.id), date: c.closedAt ?? c.updatedAt, summary: this.deps.store.readSummary(c.id) }) }))
		const playbooks = (this.playbooks?.list() ?? []).map(p => ({ id: p.id, card: playbookCard(p) }))
		return { cases, playbooks }
	}

	playbookList(): PlaybookView[] {
		return this.pb().list().map(playbookView)
	}

	playbookDetail(id: string): PlaybookDetail {
		return this.pb().detail(id)
	}

	/** Ручной запуск ревью. */
	requestReview(id: string): JobView {
		this.pb().need(id)
		return this.jobView(this.enqueue('review', id))
	}

	/** Ручное одобрение: `trial`, `before` — среднее число поправок на кейс до плейбука. */
	approvePlaybook(id: string): PlaybookView {
		const ps = this.pb()
		const p = ps.need(id)
		return playbookView(
			approvePlaybook(
				ps,
				id,
				meanCorrections(p.cases, c => this.deps.store.readSummary(c)),
			),
		)
	}

	rejectPlaybook(id: string, reason: string): PlaybookView {
		const ps = this.pb()
		ps.need(id)
		return playbookView(rejectPlaybook(ps, id, reason))
	}

	/** Ручная смена статуса: `active`, `disabled` или `archived`. */
	setPlaybookStatus(id: string, status: PlaybookStatus): PlaybookView {
		if (status !== 'active' && status !== 'disabled' && status !== 'archived') throw new AppError(400, 'bad_request', 'status — active, disabled или archived')
		return playbookView(this.pb().setStatus(id, status, 'Set by the user'))
	}

	revertPlaybook(id: string, version: number): PlaybookView {
		return playbookView(this.pb().revertToVersion(id, version))
	}

	/** Удаление плейбука; пока по нему идёт или ждёт задание — 409 `playbook_busy`. */
	removePlaybook(id: string): void {
		const ps = this.pb()
		ps.need(id)
		this.assertPlaybookIdle(id)
		ps.remove(id)
	}

	/** Принять ждущую правку улучшателя (`autoReview: false`): новая версия, запись `edit`. */
	acceptEdit(id: string, hash: string): PlaybookView {
		const ps = this.pb()
		ps.need(id)
		this.assertPlaybookIdle(id)
		return playbookView(ps.acceptEdit(id, hash))
	}

	/** Отклонить ждущую правку: хэш уходит в `rejectedEdits`. */
	rejectEdit(id: string, hash: string): PlaybookView {
		const ps = this.pb()
		ps.need(id)
		return playbookView(ps.rejectEdit(id, hash))
	}

	/** По плейбуку идёт или ждёт задание (замок плейбука) — 409 `playbook_busy`. */
	private assertPlaybookIdle(id: string): void {
		const busy = this.queue
			.list()
			.some(
				j =>
					((j.subject === id || j.subject === `edit:${id}`) && (j.status === 'queued' || j.status === 'running')) ||
					(j.status === 'running' && this.playbookOfJob(j) === id),
			)
		if (busy) throw new AppError(409, 'playbook_busy', `по плейбуку ${id} идёт задание, дождитесь его окончания`)
	}

	/** Плейбук, над которым работает задание (для замка): `review`, `edit:p-…`, `judge`/`improve` (из `payload.playbookId` или плейбука кейса). */
	private playbookOfJob(job: JobState): string | null {
		if (job.kind === 'review' && job.subject.startsWith('p-')) return job.subject
		if (job.kind === 'edit' && job.subject.startsWith('edit:p-')) return job.subject.slice('edit:'.length)
		if (job.kind === 'absorb' || job.kind === 'fold') {
			const id = job.payload?.['playbookId']
			return typeof id === 'string' ? id : null
		}
		if (job.kind === 'judge' || job.kind === 'improve') {
			const id = job.payload?.['playbookId']
			if (typeof id === 'string') return id
			const ref = this.cases.get(job.caseId)?.playbook
			return ref ? (ref.split('@')[0] ?? null) : null
		}
		return null
	}

	setPlaybookNotes(id: string, text: string): void {
		this.pb().setNotes(id, text)
	}

	setCaseNotes(id: string, text: string): void {
		this.getCase(id)
		this.deps.store.writeNotes(id, text)
	}

	journal(limit = 200, before?: string): JournalEntry[] {
		return this.pb().journal(limit, before)
	}

	revertJournal(id: string): JournalEntry {
		return this.pb().revert(id)
	}

	/** Чат объекта: кейс `c-…` или плейбук `p-…`. */
	chatOf(subject: string, limit = 200): ChatMessage[] {
		this.chatTarget(subject)
		return this.deps.playbookStore?.loadChat(subject, limit) ?? []
	}

	/** Сообщение пользователя в чат и задание `edit` (сообщения ждущего задания копятся). */
	postChat(subject: string, text: string): ChatMessage {
		this.chatTarget(subject)
		if (!text.trim()) throw new AppError(400, 'bad_request', 'text — непустая строка')
		const m = this.addChat(subject, 'user', text, [])
		this.enqueue('edit', `edit:${subject}`, { payload: { texts: [text] }, merge: mergeEditPayload })
		return m
	}

	private chatTarget(subject: string): void {
		this.pb()
		if (subject.startsWith('c-')) this.getCase(subject)
		else if (subject.startsWith('p-')) this.pb().need(subject)
		else throw new AppError(400, 'bad_request', 'чат есть у кейса (c-…) и плейбука (p-…)')
	}

	private addChat(subject: string, from: ChatMessage['from'], text: string, changes: string[]): ChatMessage {
		const m: ChatMessage = { id: `m-${this.deps.ids.next(8)}`, ts: new Date(this.deps.clock.now()).toISOString(), from, text, changes }
		this.deps.playbookStore?.appendChat(subject, m)
		this.deps.hub.publish({ t: 'learning_chat', subject, message: m })
		return m
	}

	/** Правка настроек из API: сохраняет `learning.json`, публикует `learning_settings`. */
	updateSettings(patch: unknown): LearningSettings {
		const next = patchLearningSettings(this.settings, patch)
		if (next.enabled !== this.settings.enabled) this.log('info', '', next.enabled ? 'Фоновое обучение включено' : 'Фоновое обучение выключено')
		// сессию вернули в обучение — надгробие её удалённого кейса снимается
		const back = this.settings.disabledSessions.filter(s => !next.disabledSessions.includes(s))
		if (back.length) this.untomb(back.flatMap(s => chainOf(this.deps.host.sessions(), s)))
		this.deps.store.saveSettings(next)
		this.settings = next
		// свою запись заново не читаем
		this.settingsMtime = this.deps.store.settingsMtime()
		this.deps.hub.publish({ t: 'learning_settings', settings: next })
		this.settingsChanged()
		return next
	}

	/** Удаляет кейс и его `raw/`; пока по кейсу идёт задание — 409 `case_busy`. */
	removeCase(id: string): void {
		const c = this.getCase(id)
		this.assertIdle(id)
		this.dropCase(c)
	}

	private dropCase(c: CaseState): void {
		const id = c.id
		const title = this.sessionTitle(id)
		// надгробие: живая сессия этого кейса заново его не заведёт
		const tombed = this.meta.removed.length
		this.tomb([c.rootId ?? c.sessions[0] ?? '', ...c.sessions])
		this.log('info', id, `Сессия «${title}» удалена из обучения: кейс и его события стёрты`)
		if (this.meta.removed.length > tombed) this.log('info', id, `Сессия «${title}»: поставлено надгробие, новый кейс по ней не заводится`)
		this.cases.delete(id)
		this.queue.removeCase(id)
		this.deps.store.removeCase(id)
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_case_removed', id })
	}

	/** Влитые цели ждут свёртки: каждая — отдельное задание `fold` (по сессии и цели). */
	private enqueueFolds(playbookId: string, refs: readonly FoldRef[]): void {
		for (const r of refs)
			this.enqueue('fold', `fold:${r.caseId}:${groupHash([r.goal])}`, { caseId: r.caseId, payload: { playbookId, caseId: r.caseId, goal: r.goal } })
	}

	/**
	 * Сессия свёрнута (все цели влиты): кейс удаляется без надгробия, сырые события — в скрытый архив
	 * (`archiveDays` 0 — не хранятся). Живая сессия, если оживёт, заведёт новый кейс.
	 */
	private dropFolded(id: string): void {
		const c = this.cases.get(id)
		if (!c) return
		if (this.settings.archiveDays > 0) this.deps.store.archiveRaw(id, this.deps.clock.now())
		this.cases.delete(id)
		this.queue.removeCase(id)
		this.deps.store.removeCase(id)
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_case_removed', id })
		this.purgeArchive()
	}

	/** Чистка скрытого архива по `archiveDays` (при старте и после каждой свёртки, без таймеров); 0 — архив не хранится. */
	private purgeArchive(): void {
		const gone = this.deps.store.purgeArchive(this.deps.clock.now() - this.settings.archiveDays * 86_400_000)
		if (gone.length) this.log('info', '', `Архив событий: стёрто сессий ${gone.length} (старше ${this.settings.archiveDays} дн.)`)
	}

	private saveMeta(next: LearningMeta): void {
		this.meta = next
		this.deps.store.saveMeta(next)
	}

	/** Окончательные провалы сборки за последние сутки. */
	private recentFailedBuilds(): FailedBuild[] {
		const from = this.deps.clock.now() - FAILED_BUILD_MS
		return (this.meta.failedBuilds ?? []).filter(f => f.at > from)
	}

	private tomb(ids: readonly string[]): void {
		const add = ids.filter(id => id !== '' && !this.meta.removed.includes(id))
		if (!add.length) return
		this.meta = { ...this.meta, removed: [...this.meta.removed, ...new Set(add)] }
		this.deps.store.saveMeta(this.meta)
	}

	private untomb(ids: readonly string[]): void {
		const removed = this.meta.removed.filter(id => !ids.includes(id))
		if (removed.length === this.meta.removed.length) return
		this.meta = { ...this.meta, removed }
		this.deps.store.saveMeta(this.meta)
	}

	/** Кейс упавший (`error`) возвращается в сбор: автоматически он ничего не запускал. */
	private reopen(c: CaseState): CaseState {
		if (c.status !== 'error') return c
		const next: CaseState = { ...c, status: 'collecting', closedAt: null, updatedAt: new Date(this.deps.clock.now()).toISOString() }
		this.update(next)
		return next
	}

	/** Индекс «сессия → кейс»: кейс цепочки находится по любой её сессии, а не только по корню. */
	private caseIndex(): Map<string, string> {
		const idx = new Map<string, string>()
		for (const c of this.cases.values()) for (const s of c.sessions) idx.set(s, c.id)
		return idx
	}

	private caseForChain(chain: readonly string[], idx: ReadonlyMap<string, string> = this.caseIndex()): CaseState | null {
		for (const s of chain) {
			const c = this.cases.get(idx.get(s) ?? '')
			if (c) return c
		}
		const root = chain[0]
		return root === undefined ? null : (this.cases.get(caseIdOf(root)) ?? null)
	}

	/** Живой кейс заводится только для цепочки с сессией, созданной после точки отсчёта. */
	private isFresh(chain: readonly string[], byId: ReadonlyMap<string, SessionView>): boolean {
		return chain.some(id => (Date.parse(byId.get(id)?.createdAt ?? '') || 0) >= this.meta.startedAt)
	}

	/** Пересборка описания: сбрасывает `coveredUntil` и `summary.md`, ставит итоговое задание `close`. */
	rebuild(id: string): JobView {
		const c = this.reopen(this.getCase(id))
		this.assertIdle(id)
		const fresh = this.ingestCase(c) ?? c
		this.deps.store.writeSummary(id, '')
		this.update({ ...fresh, coveredUntil: 0, updatedAt: new Date(this.deps.clock.now()).toISOString() })
		return this.jobView(this.enqueueClose(id))
	}

	/** Все незакрытые кейсы (сбор или ошибка) — на итоговый сбор. */
	runAll(): JobView[] {
		const open = [...this.cases.values()].filter(c => c.status === 'collecting' || c.status === 'error')
		return open.map(c => this.jobView(this.enqueueClose((this.ingestCase(this.reopen(c)) ?? c).id)))
	}

	private assertIdle(caseId: string): void {
		if (this.queue.running().some(j => j.caseId === caseId)) throw new AppError(409, 'case_busy', `по кейсу ${caseId} идёт задание, дождитесь его окончания`)
	}

	// ---------- сигналы хуков, законченные сессии, срок простоя ----------

	/**
	 * Сигнал хука (`POST /learning/signal`), синхронно и быстро: кейс цепочки сессии (создаётся, если нет), путь транскрипта,
	 * `lastActivityAt`. `end` — сессия закончена: ingest и задание `close`. Событий и работы агентов здесь нет.
	 * Выключено обучение, отключённая сессия или надгробие — молчим.
	 */
	signal(sig: LearningSignal): void {
		if (this.refreshSettings()) this.settingsChanged()
		if (!this.settings.enabled) return
		// затухание счётчиков плейбуков: раз в сутки, проверка дешёвая и без таймера
		this.decay()
		const c = this.ensureCase(sig.session, false)
		if (!c) return
		const now = this.deps.clock.now()
		const key = sig.chatId || sig.session
		const prev = c.transcripts[key]
		const allowed =
			sig.transcriptPath !== undefined && sig.transcriptPath !== '' && this.deps.store.isAllowedTranscript(sig.transcriptPath, this.deps.claudeProjectsDir)
		const transcripts =
			allowed && sig.transcriptPath !== undefined && prev?.path !== sig.transcriptPath
				? { ...c.transcripts, [key]: { path: sig.transcriptPath, offset: 0 } }
				: c.transcripts
		// у законченного (`ready`) кейса новая работа открывает сессию снова
		const reopened = c.status === 'ready' ? { status: 'collecting' as const, closedAt: null } : {}
		// название кейса — название последней сессии цепочки; Claude переименовывает чат в любой момент
		const all = this.deps.host.sessions()
		const last = all.some(x => x.id === c.sessions[0]) ? chainOf(all, c.sessions[0] ?? '').at(-1) : c.sessions.at(-1)
		const named = all.find(x => x.id === last)?.title.trim() ?? ''
		const title = named !== '' ? named : c.title
		const next: CaseState = {
			...c,
			...reopened,
			transcripts,
			title,
			lastActivityAt: now,
			...(title !== c.title ? { updatedAt: new Date(now).toISOString() } : {}),
		}
		this.update(next)
		if (sig.event === 'end') this.finishSession(next.id)
		else this.armIdle()
		this.pump()
	}

	/**
	 * Кейс цепочки сессии. Нет — создаётся (пустой, без событий): для живой — только свежая цепочка (после точки отсчёта),
	 * для ручного запуска (`manual`) любая, надгробие снимается. Отключённая сессия или надгробие — null.
	 */
	private ensureCase(sessionOrCase: string, manual: boolean): CaseState | null {
		const direct = this.cases.get(sessionOrCase)
		if (direct) return direct
		const sessions = this.deps.host.sessions()
		if (!sessions.some(s => s.id === sessionOrCase)) return [...this.cases.values()].find(c => c.sessions.includes(sessionOrCase)) ?? null
		const chain = chainOf(sessions, sessionOrCase)
		const root = chain[0]
		if (root === undefined) return null
		if (manual) this.untomb(chain)
		else if (chain.some(id => this.settings.disabledSessions.includes(id) || this.meta.removed.includes(id))) return null
		const have = this.caseForChain(chain)
		if (have) return this.settings.disabledSessions.some(id => have.sessions.includes(id)) && !manual ? null : have
		const byId = new Map(sessions.map(s => [s.id, s]))
		if (!manual && !this.isFresh(chain, byId)) return null
		const now = this.deps.clock.now()
		const iso = new Date(now).toISOString()
		const sessionTitle = byId.get(chain[chain.length - 1] ?? '')?.title.trim() ?? ''
		const created: CaseState = {
			id: caseIdOf(root),
			title: sessionTitle !== '' ? sessionTitle : null,
			sessions: chain,
			status: 'collecting',
			goals: [],
			events: 0,
			coveredUntil: 0,
			createdAt: iso,
			updatedAt: iso,
			closedAt: null,
			playbook: null,
			source: 'live',
			feedSeq: manual ? 0 : this.meta.startSeq,
			transcripts: {},
			nextN: 1,
			lastEventAt: 0,
			lastActivityAt: now,
			rootId: root,
			lastRunAt: now,
			nessyCalls: false,
			hinted: [],
		}
		this.update(created)
		this.log('info', created.id, `Новая сессия «${this.sessionTitle(created.id)}»`)
		return created
	}

	/** Событий цепочки, которые ещё не в `raw/`: лента после `feedSeq` и транскрипты после смещения. Возвращает обновлённый кейс; не записалось на диск — null (курсоры не сдвинуты). */
	private ingestCase(existing: CaseState): CaseState | null {
		const { host, store, clock } = this.deps
		const sessions = host.sessions()
		const byId = new Map(sessions.map(s => [s.id, s]))
		const first = existing.sessions[0] ?? existing.rootId ?? ''
		const chain = byId.has(first) ? chainOf(sessions, first) : existing.sessions
		const base = existing
		const id = base.id
		const iso = new Date(clock.now()).toISOString()
		const inChain = new Set(chain)
		const unseen = host.messagesSince(base.feedSeq)
		const mine = unseen.filter(m => {
			const s = host.sessionOfMessage(m)
			return s !== null && inChain.has(s)
		})
		const transcripts: Array<{ chatId: string; text: string; next: TranscriptCursor }> = []
		const done = new Set<string>()
		const take = (key: string, file: string): void => {
			if (done.has(key)) return
			done.add(key)
			// чужие файлы (не из каталога проектов Claude Code, не .jsonl) не читаем
			if (!store.isAllowedTranscript(file, this.deps.claudeProjectsDir)) return
			const prev = base.transcripts[key]
			const cur: TranscriptCursor = prev && prev.path === file ? prev : { path: file, offset: 0 }
			const r = store.copyTranscript(id, key, cur)
			if (r.text || r.next.offset !== cur.offset || r.next.path !== prev?.path) transcripts.push({ chatId: key, text: r.text, next: r.next })
		}
		for (const sid of chain) {
			const s = byId.get(sid)
			if (s?.transcriptPath) take(s.chatId ?? sid, s.transcriptPath)
		}
		// путь из сигнала хука, которого нет у сессии
		for (const [key, cur] of Object.entries(base.transcripts)) take(key, cur.path)
		const { events, state } = ingest(base, { messages: mine, transcripts, playbookVersion: this.playbookVersion })
		const maxSeen = unseen.reduce((max, m) => Math.max(max, m.seq), state.feedSeq)
		const touched = chain.reduce((max, sid) => Math.max(max, Date.parse(byId.get(sid)?.updatedAt ?? '') || 0), state.lastEventAt)
		// название кейса — название сессии (последней в цепочке); Claude меняет его позже
		const sessionTitle = byId.get(chain[chain.length - 1] ?? '')?.title.trim() ?? ''
		const title = sessionTitle !== '' ? sessionTitle : state.title
		const next: CaseState = {
			...state,
			title,
			feedSeq: maxSeen,
			sessions: chain,
			...((base.rootId ?? chain[0]) ? { rootId: base.rootId ?? chain[0] } : {}),
			lastEventAt: touched,
			updatedAt: events.length || chain.join() !== base.sessions.join() || title !== base.title ? iso : base.updatedAt,
		}
		// не записалось — курсоры ленты и транскриптов не двигаем: в следующий раз повторим
		if (events.length && !store.appendRaw(id, events)) {
			this.log('error', id, `«${next.title ?? id}»: не удалось записать события на диск, повторю через ${fmtDuration(this.settings.retrySec * 1000)}`)
			return null
		}
		this.update(next)
		return next
	}

	/**
	 * Сессия закончена (`SessionEnd`, закрытая вкладка или простой `idleMin`): ingest, затем итоговое задание `close`.
	 * Событий нет вовсе — кейс удаляется. Задание по кейсу уже есть — ничего не делает.
	 */
	private finishSession(caseId: string): void {
		const c0 = this.cases.get(caseId)
		if (!c0 || this.hasJob(caseId)) return
		const c = this.ingestCase(c0)
		if (!c) {
			// диск не принял события: курсоры стоят, одноразовый повтор через `retrySec`
			if (!this.ingestRetry.has(caseId)) {
				const t = setTimeout(() => {
					this.ingestRetry.delete(caseId)
					if (!this.stopped) this.finishSession(caseId)
				}, this.settings.retrySec * 1000)
				t.unref()
				this.ingestRetry.set(caseId, t)
			}
			return
		}
		if (c.events === 0) {
			this.removeEmpty(c.id)
			this.armIdle()
			return
		}
		if (c.events - c.coveredUntil > 0) {
			this.enqueueClose(c.id)
			this.armIdle()
			return
		}
		// всё уже учтено в описании: кейс остаётся готовым
		if (c.status !== 'ready') this.seal(c.id)
		this.armIdle()
	}

	/** Кейс без событий убирается вместе с `raw/` и заданиями. */
	private removeEmpty(caseId: string): void {
		this.log('info', caseId, `Сессия «${this.sessionTitle(caseId)}»: событий нет, кейс убран`)
		this.cases.delete(caseId)
		this.queue.removeCase(caseId)
		this.deps.store.removeCase(caseId)
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_case_removed', id: caseId })
	}

	/** Итоговое задание кейса: кейс `closing`, задание в очередь. */
	private enqueueClose(caseId: string): JobState {
		const c = this.cases.get(caseId)
		if (c && c.status !== 'closing') this.update({ ...c, status: 'closing', updatedAt: new Date(this.deps.clock.now()).toISOString() })
		return this.request('close', caseId, true)
	}

	/**
	 * Единственный таймер простоя: на ближайший срок `lastActivityAt + idleMin` среди открытых кейсов без задания.
	 * Пересчитывается на каждом сигнале, смене настроек и старте; на срабатывании законченные по простою сессии уходят в очередь.
	 */
	private armIdle(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer)
		this.idleTimer = null
		if (this.stopped || !this.settings.enabled) return
		const span = this.settings.idleMin * 60_000
		let due: number | null = null
		for (const c of this.cases.values()) {
			if (c.status !== 'collecting' || this.hasJob(c.id)) continue
			const at = (c.lastActivityAt ?? c.lastEventAt) + span
			due = due === null ? at : Math.min(due, at)
		}
		if (due === null) return
		this.idleTimer = setTimeout(
			() => {
				this.idleTimer = null
				if (this.stopped) return
				this.onIdle()
			},
			Math.max(0, due - this.deps.clock.now()),
		)
		this.idleTimer.unref()
	}

	private onIdle(): void {
		if (this.refreshSettings()) this.settingsChanged()
		if (this.settings.enabled) {
			const now = this.deps.clock.now()
			const span = this.settings.idleMin * 60_000
			for (const c of [...this.cases.values()]) {
				if (c.status === 'collecting' && !this.hasJob(c.id) && now - (c.lastActivityAt ?? c.lastEventAt) >= span) this.finishSession(c.id)
			}
		}
		this.armIdle()
		this.pump()
	}

	/** Настройки поменялись (файл или API): таймеры пересчитываются, насос запускается. */
	private settingsChanged(): void {
		this.armIdle()
		this.armStall()
		this.pump()
	}

	/** Сохраняет и публикует кейс, если что-то изменилось. */
	private update(next: CaseState): void {
		const prev = this.cases.get(next.id)
		if (prev && JSON.stringify(prev) === JSON.stringify(next)) return
		this.cases.set(next.id, next)
		this.deps.store.saveCase(next)
		if (!prev || JSON.stringify(toView(prev)) !== JSON.stringify(toView(next))) this.deps.hub.publish({ t: 'learning_case', case: toView(next) })
	}

	/** Перечитывает `learning.json`, если файл изменился (горячая перезагрузка); true — настройки поменялись. */
	private refreshSettings(): boolean {
		const mtime = this.deps.store.settingsMtime()
		if (mtime === this.settingsMtime) return false
		const { raw, mtimeMs } = this.deps.store.loadSettings()
		const was = this.settings.enabled
		this.settings = raw === undefined ? parseLearningSettings({ enabled: this.deps.defaultOn }) : parseLearningSettings(raw)
		this.settingsMtime = mtimeMs
		if (this.loaded && this.settings.enabled !== was)
			this.log(
				'info',
				'',
				this.settings.enabled ? 'Фоновое обучение включено (настройки изменены в файле)' : 'Фоновое обучение выключено (настройки изменены в файле)',
			)
		return true
	}

	private readSettings(): void {
		this.refreshSettings()
	}

	private request(kind: JobKind, caseId: string, final: boolean): JobState {
		return this.enqueue(kind, caseId, { caseId, final })
	}

	private enqueue(kind: JobKind, subject: string, opts: EnqueueOpts = {}): JobState {
		const known = this.queue.list().some(j => j.subject === subject && j.status === 'queued')
		const job = this.queue.enqueue(kind, subject, opts)
		if (!known && kind !== 'collect' && kind !== 'close') this.log('info', subject, `${this.jobLabel(job)}: поставлено в очередь`)
		this.jobsChanged(job)
		this.pump()
		return job
	}

	/** Версия известного плейбука для `case.playbook`; неизвестного — undefined (в кейсе будет `@0`). */
	private readonly playbookVersion = (id: string): number | undefined => this.playbooks?.get(id)?.version

	private caseOfSession(session: string): CaseState | null {
		for (const c of this.cases.values()) if (c.sessions.includes(session)) return c
		return null
	}

	private markHinted(session: string, playbookId: string): void {
		const c = this.caseOfSession(session)
		if (!c) {
			const set = this.memHinted.get(session) ?? new Set<string>()
			set.add(playbookId)
			this.memHinted.set(session, set)
			return
		}
		if (!c.hinted.includes(playbookId)) this.update({ ...c, hinted: [...c.hinted, playbookId] })
	}

	/** Задание ждёт, пока идёт конфликтующее (правка кейса, то же задание плейбука). */
	private isWaiting(job: JobState): boolean {
		// правка кейса из чата и сборщик/закрытие того же кейса не идут одновременно
		const running = this.queue.list().filter(j => j.status === 'running')
		if (job.kind === 'edit' && job.subject.startsWith('edit:c-')) {
			const target = job.subject.slice('edit:'.length)
			if (running.some(j => j.caseId === target || j.subject === target)) return true
		} else if (job.kind === 'collect' || job.kind === 'close') {
			if (running.some(j => j.kind === 'edit' && j.subject === `edit:${job.caseId || job.subject}`)) return true
		}
		// свёртка не идёт, пока работают задания над той же сессией (в том числе проверка и вливание, где она член группы)
		if (job.kind === 'fold') {
			const id = job.caseId
			if (
				running.some(
					j =>
						j.id !== job.id && (j.caseId === id || (['match', 'verify', 'build', 'absorb'].includes(j.kind) && JSON.stringify(j.payload ?? {}).includes(id))),
				)
			)
				return true
		}
		// замок плейбука: пока другое задание того же плейбука работает, это ждёт
		const target = this.playbookOfJob(job)
		if (target !== null && running.some(j => j.id !== job.id && this.playbookOfJob(j) === target)) return true
		return false
	}

	private hasJob(caseId: string): boolean {
		return this.queue.hasJob(caseId)
	}

	/** Ручной «Собрать кейс сейчас»: задание `close` по кейсу или по сессии; работает и при выключенном обучении. */
	runNow(sessionOrCaseId: string): JobView {
		const found = this.ensureCase(sessionOrCaseId, true)
		if (!found) throw new AppError(404, 'no_case', `нет кейса или сессии ${sessionOrCaseId}`)
		const reopened = this.reopen(found)
		const c = this.ingestCase(reopened) ?? reopened
		return this.jobView(this.enqueueClose(c.id))
	}

	/** Вкладку закрыли: сессия закончена — сразу в очередь. Выключено (в целом или для сессии) — молчим. */
	onSessionClosed(sessionId: string): void {
		this.signal({ event: 'end', session: sessionId })
	}

	/** Ручной повтор упавшего задания. */
	retry(jobId: string): JobView {
		const job = this.queue.retry(jobId)
		const c = this.cases.get(job.caseId)
		if (c && c.status === 'error')
			this.update({ ...c, status: job.kind === 'close' ? 'closing' : 'collecting', closedAt: null, updatedAt: new Date(this.deps.clock.now()).toISOString() })
		this.jobsChanged(job)
		this.pump()
		return this.jobView(job)
	}

	/** Сессию нельзя удалять, пока её кейс не `ready` (если обучение для неё включено); `error` не защищает: события уже в `raw/`. */
	isProtected(sessionId: string): boolean {
		if (!this.settings.enabled || this.settings.disabledSessions.includes(sessionId)) return false
		for (const c of this.cases.values()) if (c.sessions.includes(sessionId)) return c.status !== 'ready' && c.status !== 'error'
		return false
	}

	private jobsChanged(job: JobState): void {
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_job', job: this.jobView(job) })
		for (const merged of this.queue.takeAbsorbed()) this.deps.hub.publish({ t: 'learning_job', job: this.jobView(merged) })
	}

	/**
	 * Насос: пока есть место (`maxAgents`) и готовое задание — запускает, синхронно и сразу (FIFO).
	 * Зовётся на постановке, окончании задания, смене настроек и после сигнала. Замок плейбука/кейса — не состояние:
	 * заблокированное задание остаётся `queued` и уступает место следующему. Провалившиеся задания держат слот.
	 */
	private pump(): void {
		if (this.stopped || this.pumping) return
		this.pumping = true
		try {
			if (this.refreshSettings()) {
				this.armIdle()
				this.armStall()
			}
			for (;;) {
				if (this.queue.running().length >= this.settings.maxAgents) break
				const job = this.queue.next(j => this.isWaiting(j))
				if (!job) break
				this.launch(job)
			}
		} finally {
			this.pumping = false
		}
		this.armStall()
	}

	/** Агент задания больше не нужен (задание кончилось, снято, сменило агента): убирается. */
	private releaseAgentOf(job: JobState): void {
		if (job.agentId) void this.deps.host.releaseAgent?.(job.agentId).catch(() => undefined)
		this.runCalls.delete(job.id)
	}

	/** Когда агент задания в последний раз подавал признаки жизни, мс (событие агента, иначе активность задания). */
	private lastLife(j: JobState): number {
		const agent = j.agentId ? (this.deps.host.agentActivity?.(j.agentId) ?? null) : null
		return Math.max(agent ?? 0, j.activityAt ?? 0, j.startedAt ? Date.parse(j.startedAt) : 0)
	}

	/**
	 * Сторожевой таймер: один одноразовый на ближайший срок молчания агента идущего задания (`stallMin`);
	 * `stallMin = 0` — сторож выключен, таймера нет вовсе.
	 */
	private armStall(): void {
		if (this.stallTimer) clearTimeout(this.stallTimer)
		this.stallTimer = null
		if (this.stopped || this.settings.stallMin <= 0) return
		const span = this.settings.stallMin * 60_000
		const live = this.queue.running().filter(j => !this.failed.has(j.id))
		if (!live.length) return
		const due = Math.min(...live.map(j => this.lastLife(j) + span))
		this.stallTimer = setTimeout(
			() => {
				this.stallTimer = null
				if (!this.stopped) this.checkStalls()
			},
			Math.max(0, due - this.deps.clock.now()),
		)
		this.stallTimer.unref()
	}

	/** Идущие задания, чей агент молчит `stallMin` минут, — провал попытки (повтор по `retrySec`). */
	private checkStalls(): void {
		const span = this.settings.stallMin * 60_000
		if (span > 0) {
			const now = this.deps.clock.now()
			for (const j of this.queue.running()) if (!this.failed.has(j.id) && now - this.lastLife(j) >= span) this.stall(j)
		}
		this.armStall()
		this.pump()
	}

	/** Зависшее задание: агент отменяется, итог прежнего запуска игнорируется; остановленное пользователем — `done`. */
	private stall(job: JobState): void {
		this.runGen.delete(job.id)
		if (job.agentId) void this.deps.host.cancelAgent(job.agentId).catch(() => undefined)
		if (this.cancelled.has(job.id)) return this.finishCancelled(job)
		this.failNow(job, `нет событий агента ${this.settings.stallMin} мин: агент снят`)
	}

	private launch(queued: JobState): void {
		const job = this.queue.start(queued.id, null)
		this.log('info', job.subject, `${this.jobLabel(job)}: агент запущен, попытка ${job.attempts + 1}`)
		try {
			const c = this.cases.get(job.caseId)
			if (c && job.kind === 'close' && c.status !== 'closing')
				this.update({ ...c, status: 'closing', updatedAt: new Date(this.deps.clock.now()).toISOString() })
			this.jobsChanged(job)
		} catch {
			/* запись на диск не удалась: задание всё равно идёт, иначе слот завис бы в `running` без исполнителя */
		}
		this.runAttempt(job)
	}

	/** Одна попытка исполнения (первая или повтор): новое поколение запуска, поздние итоги прежних игнорируются. */
	private runAttempt(job: JobState): void {
		this.failed.delete(job.id)
		const gen = ++this.genSeq
		this.runGen.set(job.id, gen)
		this.queue.touch(job.id)
		const run = this.execute(job, gen)
			.catch((e: unknown) => this.fail(job, e instanceof Error ? e.message : String(e), gen))
			.finally(() => {
				this.inflight.delete(run)
				if (this.runGen.get(job.id) === gen) this.runGen.delete(job.id)
				this.pump()
			})
		this.inflight.add(run)
	}

	/** Таймер повтора: через `retrySec` задание, оставшееся `running`, делает новую попытку. */
	private scheduleRetry(job: JobState): void {
		const old = this.retryTimers.get(job.id)
		if (old) clearTimeout(old)
		const t = setTimeout(() => {
			this.retryTimers.delete(job.id)
			if (this.stopped || !this.failed.has(job.id)) return
			const j = this.queue.running().find(x => x.id === job.id)
			if (!j) return
			this.log('info', j.subject, `${this.jobLabel(j)}: повтор, попытка ${j.attempts + 1}`)
			this.runAttempt(j)
		}, this.settings.retrySec * 1000)
		t.unref()
		this.retryTimers.set(job.id, t)
	}

	private isStale(job: JobState, gen: number): boolean {
		return this.runGen.get(job.id) !== gen
	}

	/** Исполнение задания обработчиком своего вида; исключение — провал, нет обработчика — окончательный провал без повторов. */
	private async execute(job: JobState, gen: number): Promise<void> {
		const handler = this.handlers.get(job.kind)
		if (!handler) return this.fail(job, `нет обработчика задания ${job.kind}`, gen)
		try {
			await handler.run(this.context(job, gen))
		} catch (e) {
			// сторож уже снял этот запуск: поздний итог игнорируется
			if (this.isStale(job, gen)) return
			// остановка пользователем: обработчик бросил отмену агента — это не провал
			if (this.cancelled.has(job.id)) return this.finishCancelled(job)
			throw e
		}
		if (this.isStale(job, gen)) return
		if (this.interrupted.has(job.id)) return
		if (this.cancelled.has(job.id)) return this.finishCancelled(job)
		// обработчик мог завершить задание сам (сбор: до постановки следующего)
		if (job.status === 'running') this.finishJob(job)
	}

	/** Обработчик вернулся после остановки: задание `done` с пометкой, без повторов и `error`; кейс `closing` → `collecting`. */
	private finishCancelled(job: JobState): void {
		if (job.status === 'running') {
			this.log('info', job.subject, `${this.jobLabel(job)}: остановлено пользователем`)
			this.dropTimers(job.id)
			this.releaseAgentOf(job)
			this.jobsChanged(this.queue.cancel(job.id, CANCELLED))
			this.reopenClosing(job.caseId)
		}
		this.cancelled.delete(job.id)
	}

	private finishJob(job: JobState, note?: string): void {
		if (note !== undefined) job.note = note
		const took = job.startedAt ? fmtDuration(this.deps.clock.now() - Date.parse(job.startedAt)) : null
		this.log('info', job.subject, `${this.jobLabel(job)}: готово${took ? ` за ${took}` : ''}${note ? ` (${note})` : ''}`)
		this.dropTimers(job.id)
		this.releaseAgentOf(job)
		this.queue.finish(job.id)
		this.jobsChanged(job)
	}

	/** Задание кончилось: таймер повтора и отметка ожидания повтора снимаются. */
	private dropTimers(id: string): void {
		const t = this.retryTimers.get(id)
		if (t) clearTimeout(t)
		this.retryTimers.delete(id)
		this.failed.delete(id)
	}

	private context(job: JobState, gen: number): JobContext {
		const { store, host, clock } = this.deps
		// агент провалившейся попытки продолжает только в первом вызове новой
		let reuse = job.attempts > 0 && job.agentId !== null
		return {
			job,
			now: () => clock.now(),
			settings: () => this.settings,
			runAgent: async (name, title, prompt) => {
				if (this.cancelled.has(job.id)) throw new Error(CANCELLED)
				// новый вызов агента — активность (сторожевой таймер считается от него)
				this.queue.touch(job.id)
				job.title = title
				let agentId: string | undefined
				if (reuse && job.agentId) {
					if (host.agentAlive?.(job.agentId)) agentId = job.agentId
					else {
						this.log('info', job.subject, `${this.jobLabel(job)}: агент прошлой попытки недоступен, запускаю нового`)
						void host.releaseAgent?.(job.agentId).catch(() => undefined)
					}
				}
				reuse = false
				const res = await host.runAgent({
					name,
					title,
					prompt: agentId
						? `Previous attempt failed: ${job.error ?? 'unknown error'}. Continue from the last accepted summary (the server keeps everything it accepted); if nothing was accepted yet, start the task over as instructed.`
						: prompt,
					...(agentId ? { agentId } : {}),
					// id агента известен сразу: «Остановить» и живой чат в приложении работают, пока агент идёт
					onSpawn: agentId => {
						if (this.isStale(job, gen)) return void host.cancelAgent(agentId).catch(() => undefined)
						job.agentId = agentId
						this.queue.touch(job.id)
						this.jobsChanged(job)
						if (this.interrupted.has(job.id) || this.cancelled.has(job.id)) void host.cancelAgent(agentId).catch(() => undefined)
					},
				})
				if (this.isStale(job, gen)) throw new Error('снято сторожем')
				job.agentId = res.agentId
				// агент после ответа удаляется: ответ остаётся в runs/ (см. `LearningStorePort.writeRun`)
				// остановлено пользователем: ответ не пишется
				if (this.cancelled.has(job.id)) throw new Error(CANCELLED)
				const calls = (this.runCalls.get(job.id) ?? 0) + 1
				this.runCalls.set(job.id, calls)
				if (res.text) store.writeRun(job.subject, `${job.id}-${calls}`, res.text)
				if (this.interrupted.has(job.id)) throw new Error('прервано остановкой')
				if (!res.ok) throw new Error(res.error ?? 'агент завершился с ошибкой')
				return { agentId: res.agentId, text: res.text }
			},
			prompt: name => store.readPrompt(name),
			cases: {
				get: id => this.cases.get(id) ?? null,
				all: () => [...this.cases.values()],
				summary: id => store.readSummary(id),
				notes: id => store.readNotes(id),
				raw: (id, from, to) => store.readRaw(id, from, to),
				update: c => this.update(c),
				writeSummary: (id, text) => store.writeSummary(id, text),
				writeNotes: (id, text) => store.writeNotes(id, text),
				writeDraft: (id, text) => store.writeDraft(id, text),
				sessionTitle: id => this.sessionTitle(id),
				seal: id => this.seal(id, job.startedAt ? Date.parse(job.startedAt) : undefined),
				drop: id => this.dropFolded(id),
			},
			log: (level, subject, text) => this.log(level, subject, text),
			failedBuilds: () => this.recentFailedBuilds(),
			playbooks: this.playbooks,
			hints: this.hints,
			enqueue: (kind, subject, opts) => void this.enqueue(kind, subject, opts),
			chat: (subject, text, changes) => void this.addChat(subject, 'agent', text, changes),
			finish: note => {
				if (!this.isStale(job, gen)) this.finishJob(job, note)
			},
			changed: () => {
				if (this.isStale(job, gen)) return
				this.queue.touch(job.id)
				this.jobsChanged(job)
			},
		}
	}

	/** Провал запуска `gen`: поздний итог снятого сторожем запуска игнорируется. */
	private fail(job: JobState, error: string, gen: number): void {
		if (this.interrupted.has(job.id) || this.isStale(job, gen)) return
		if (this.cancelled.has(job.id)) return this.finishCancelled(job)
		this.failNow(job, error)
	}

	/**
	 * Провал попытки: задание остаётся `running` (слот за ним), ошибка — в диалог агента и в журнал,
	 * через `retrySec` — повтор: тому же агенту «continue» (жив и свободен), иначе новый агент. Число повторов не ограничено.
	 */
	private failNow(job: JobState, error: string): void {
		this.runGen.delete(job.id)
		const j = this.queue.fail(job.id, error)
		this.failed.add(j.id)
		this.log('warn', j.subject, `${this.jobLabel(j)}: не удалось: ${error}; повтор через ${fmtDuration(this.settings.retrySec * 1000)}`)
		if (j.agentId) this.deps.host.noteAgent?.(j.agentId, `Attempt ${j.attempts} failed: ${error}. Retry in ${this.settings.retrySec} s.`, 'error')
		// провал любой попытки сборки: пока она повторяется, `match` не ставит ту же группу заново
		if (j.kind === 'build') this.rememberFailedBuild(j)
		this.jobsChanged(j)
		this.scheduleRetry(j)
	}

	/** Провал сборки: `{ hash, cases, at }` в `meta.json` (старше суток записи отбрасываются). */
	private rememberFailedBuild(job: JobState): void {
		const raw: unknown = job.payload?.['cases']
		const found = new Set<string>()
		if (Array.isArray(raw))
			for (const e of raw as unknown[]) if (typeof e === 'object' && e !== null && 'caseId' in e && typeof e.caseId === 'string') found.add(e.caseId)
		const cases = [...found].sort()
		if (!cases.length) return
		const hash = job.subject.replace(/^g-/, '')
		const rest = this.recentFailedBuilds().filter(f => f.hash !== hash)
		this.saveMeta({ ...this.meta, failedBuilds: [...rest, { hash, cases, at: this.deps.clock.now() }] })
	}

	/** Раз в сутки: счётчики и архив правок всех живых плейбуков без новых вердиктов (затухание); смена статуса правила — версия и журнал. */
	private decay(): void {
		const ps = this.playbooks
		if (!ps) return
		const now = this.deps.clock.now()
		if (this.meta.lastRecountAt !== undefined && now - this.meta.lastRecountAt < RECOUNT_MS) return
		const running = this.queue.running()
		let skipped = false
		for (const p of ps.list()) {
			if (p.status === 'disabled' || p.status === 'archived') continue
			// плейбук занят заданием: пересчёт в следующий тик, чтобы не затереть его версию
			if (running.some(j => this.playbookOfJob(j) === p.id)) {
				skipped = true
				continue
			}
			const { state, changed } = recount(p, now)
			// только смена статуса правила даёт версию: счётчики без неё пересчитает следующий вердикт судьи
			if (!changed.length) continue
			const entry = (c: { ruleId: string; from: string; to: string }): Omit<JournalEntry, 'id' | 'ts'> => ({
				kind: 'rule_archived',
				subject: p.id,
				summary: `${p.id}: правило «${p.rules.find(r => r.id === c.ruleId)?.text ?? c.ruleId}» ${c.from} → ${c.to} (затухание)`,
				report: JSON.stringify({ ruleId: c.ruleId, prevStatus: c.from }),
				revertible: true,
				revertedBy: null,
			})
			const [first, ...rest] = changed
			ps.saveVersion(state, `Decay: ${changed.length} rules archived`, first ? entry(first) : undefined)
			for (const c of rest) ps.record(entry(c))
		}
		if (!skipped) this.saveMeta({ ...this.meta, lastRecountAt: now })
	}

	/** Итоговое описание готово: кейс `ready`; пустой кейс (нет ни описания, ни событий) удаляется. */
	private seal(caseId: string, since?: number): void {
		const c = this.cases.get(caseId)
		if (!c) return
		const iso = new Date(this.deps.clock.now()).toISOString()
		if (c.events === 0 && this.deps.store.readSummary(caseId).trim() === '') {
			this.removeEmpty(caseId)
			return
		}
		// за время итогового сбора в сессии снова работали: кейс остаётся открытым, срок простоя пойдёт заново
		const again = since !== undefined && (c.lastActivityAt ?? 0) > since
		this.update(again ? { ...c, status: 'collecting', closedAt: null, updatedAt: iso } : { ...c, status: 'ready', closedAt: iso, updatedAt: iso })
		if (again) {
			this.armIdle()
			return
		}
		this.log(
			'info',
			caseId,
			`Сессия «${this.sessionTitle(caseId)}» обработана: ${c.events} ${plural(c.events, 'событие', 'события', 'событий')}, ${c.goals.length} ${plural(c.goals.length, 'цель', 'цели', 'целей')}`,
		)
		// судья и сопоставитель — только при плейбуках
		if (this.playbooks) {
			onCaseReady(
				{
					cases: { get: id => this.cases.get(id) ?? null },
					enqueue: (kind, subject, opts) => void this.enqueue(kind, subject, opts),
				},
				caseId,
			)
		}
	}
}
