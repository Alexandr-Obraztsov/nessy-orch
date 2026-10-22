import type { CaseDraftResult, CaseImpact, CaseReadBlock, ChatMessage, JobDetail, JournalEntry, PlaybookDetail, PlaybookPatch, PlaybookStatus, PlaybookView } from '../../../shared/types'
import type { CaseDetail, CaseView, JobKind, JobView, LearningSettings, LearningView, Message, RawEvent, SessionView } from '../../../shared/types'
import { createHash } from 'node:crypto'
import { AppError } from '../../domain/errors'
import { parseSummaryHeads } from '../../domain/collector'
import { decide } from '../../domain/learning-schedule'
import { COOLDOWN_MS, JOB_STALL_MS, TICK_DEBOUNCE_MS, parseLearningSettings, patchLearningSettings } from '../../domain/learning-settings'
import { caseIdOf, chainOf, ingest } from './case-ingest'
import { onCaseReady } from './case-ready'
import { buildHandler } from './build.handler'
import { collectHandler } from './collect.handler'
import { editHandler, mergeEditPayload } from './edit.handler'
import { improveHandler } from './improve.handler'
import { judgeHandler } from './judge.handler'
import { matchHandler } from './match.handler'
import { applyPatch } from './playbook-edits'
import { lintPlaybook } from '../../domain/playbook-lint'
import { renderPlaybook } from '../../domain/playbook-render'
import { approvePlaybook, meanCorrections, rejectPlaybook, reviewHandler } from './review.handler'
import type { HintHost, JobContext, JobHandler } from './handlers.types'
import { JobQueue } from './job-queue'
import { PlaybookService, playbookView } from './playbook.service'
import { ReadProtocol, protocolPhase, protocolProgress } from './read-protocol'
import type { CaseState, EnqueueOpts, FailedBuild, JobState, LearningDeps, LearningMeta, LogLevel, TranscriptCursor } from './learning.types'
import { recount } from '../../domain/rule-counters'

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
	source: 'live',
})

/** Фоновое обучение: события сессий (с учётом цепочки `/clear`) собираются в кейсы, кейсам назначаются задания. */
/** Сколько задание может молчать: сборщик сессии (читает блоками и сдаёт саммари) — `JOB_STALL_MS`; сборка плейбука, ревью и прочие долгие работы одним ходом — втрое дольше. */
const stallMs = (j: { kind: string }): number => (j.kind === 'collect' || j.kind === 'close' ? JOB_STALL_MS : JOB_STALL_MS * 3)

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
	private ticker: NodeJS.Timeout | null = null
	private wake: NodeJS.Timeout | null = null
	/** отложенный `tick` по событию шины (окно `TICK_DEBOUNCE_MS`) */
	private tickSoon: NodeJS.Timeout | null = null
	/** `tick` к моменту, когда у кейса с необработанными событиями кончится пауза `COOLDOWN_MS` */
	private tickDue: { at: number; timer: NodeJS.Timeout } | null = null
	private unsubscribe: (() => void) | null = null
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
	/** до какого `seq` ленты просмотрена цепочка без кейса (корень → seq), только в памяти */
	private readonly scanned = new Map<string, number>()
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
			? new PlaybookService({ store: deps.playbookStore, hub: deps.hub, clock: deps.clock, ids: deps.ids, pluginVersion: deps.pluginVersion, caseOf: id => this.cases.get(id) ?? null })
			: null
		this.registerHandler(collectHandler)
		// обработчики плейбуков — только при хранилище плейбуков
		if (this.playbooks) for (const h of [matchHandler, buildHandler, reviewHandler, judgeHandler, improveHandler, editHandler]) this.registerHandler(h)
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
			this.cases.set(c.id, c.rootId === undefined ? { ...c, rootId: c.sessions[0] ?? c.id } : c)
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
		for (const j of jobs) if (j.status === 'running') this.log('warn', j.subject, `${this.jobLabel(j)}: прервано перезапуском, продолжаю`)
		// после рестарта `running` вернулись в очередь: фиксируем это на диске
		if (jobs.some(j => j.status === 'running')) this.deps.store.saveJobs(this.queue.list())
		this.readSettings()
		this.loaded = true
	}

	/** Запуск: насос сразу (задания после рестарта) и таймер `tick` раз в `tickMs` (0 — без таймера). */
	start(): void {
		this.stopped = false
		const pending = this.queue.list().filter(j => j.status === 'queued' || j.status === 'running').length
		this.log('info', '', `Фоновое обучение запущено: кейсов ${this.cases.size}, заданий в работе и очереди ${pending}`)
		this.pump()
		// новое сообщение или сессия — `tick` через `TICK_DEBOUNCE_MS`, не дожидаясь опроса (он остался подстраховкой)
		if (this.deps.tickMs > 0 && !this.unsubscribe) {
			this.unsubscribe = this.deps.hub.subscribe(e => {
				if (e.t === 'session' || (e.t === 'message' && this.deps.host.sessionOfMessage(e.message) !== null)) this.requestTick()
			})
		}
		if (this.deps.tickMs > 0 && !this.ticker) {
			this.ticker = setInterval(() => {
				try {
					this.tick()
				} catch {
					/* сбой одного тика не должен ронять сервер */
				}
			}, this.deps.tickMs)
			this.ticker.unref()
		}
	}

	/** Останавливает таймеры и приём заданий; идущих сборщиков ждёт не дольше 5 с (остальные вернутся в очередь при рестарте). */
	async stop(): Promise<void> {
		this.stopped = true
		this.log('info', '', 'Фоновое обучение остановлено')
		if (this.ticker) clearInterval(this.ticker)
		if (this.wake) clearTimeout(this.wake)
		if (this.tickSoon) clearTimeout(this.tickSoon)
		if (this.tickDue) clearTimeout(this.tickDue.timer)
		this.unsubscribe?.()
		this.ticker = null
		this.wake = null
		this.tickSoon = null
		this.tickDue = null
		this.unsubscribe = null
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
			this.jobsChanged(this.queue.requeue(j.id, 'прервано остановкой'))
		}
	}

	getSettings(): LearningSettings {
		return this.settings
	}

	view(): LearningView {
		const cases = [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toView)
		return { settings: this.settings, jobs: this.queue.list().map(j => this.jobView(j)), cases, playbooks: this.playbooks?.list().map(playbookView) ?? [], journal: this.playbooks?.journal(300) ?? [], rev: this.deps.hub.rev }
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
		const jobs = this.queue.list().filter(j => j.caseId === id && (j.kind === 'collect' || j.kind === 'close') && (j.status === 'queued' || j.status === 'running'))
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
		}
		return this.jobView(job)
	}

	/** Кейс в `closing`, у которого не осталось заданий сборки, возвращается в `collecting`. */
	private reopenClosing(caseId: string): void {
		const c = this.cases.get(caseId)
		if (!c || c.status !== 'closing') return
		if (this.queue.list().some(j => j.caseId === caseId && j.kind === 'close' && (j.status === 'queued' || j.status === 'running') && !this.cancelled.has(j.id))) return
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
	 * Правка плейбука блоками: новая версия и запись журнала `edit`. Замок плейбука — 409 `playbook_busy`;
	 * `baseVersion` не совпала с текущей — 409 `stale` с `version`;
	 * критичные замечания `lintPlaybook` (не строгие к доказательствам) — 400 `lint`.
	 */
	patchPlaybook(id: string, patch: PlaybookPatch): PlaybookView {
		const ps = this.pb()
		const p = ps.need(id)
		this.assertPlaybookIdle(id)
		if (patch.baseVersion !== p.version) throw new AppError(409, 'stale', `плейбук ${id} изменился: версия ${p.version}, правили ${patch.baseVersion}`, { version: p.version })
		const next = applyPatch(p, patch, new Date(this.deps.clock.now()).toISOString())
		const known = new Set(this.cases.keys())
		const critical = lintPlaybook(next, renderPlaybook(next, ps.notes(id), ''), known, { strictEvidence: false }).filter(i => i.level === 'critical')
		if (critical.length) throw new AppError(400, 'lint', critical.map(i => `${i.where}: ${i.text}`).join('\n'))
		const fields = Object.keys(patch).filter(k => k !== 'baseVersion').join(', ')
		return playbookView(ps.saveVersion(next, `Edited by the user: ${fields}`, { kind: 'edit', subject: id, summary: `${id}: правка блоками (${fields})`, report: null, revertible: true, revertedBy: null }))
	}

	/** Кейс с описанием, заметками и черновиком. */
	getCaseDetail(id: string): CaseDetail {
		const c = this.getCase(id)
		const summary = this.deps.store.readSummary(id)
		return { ...toView(c), summary, summaryHash: summaryHash(summary), notes: this.deps.store.readNotes(id), draft: this.deps.store.readDraft(id), progress: this.progressOf(id) }
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
				return 'Сопоставление кейсов с плейбуками'
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
		const view: JobView & { protocol?: unknown } = { ...this.queue.toView(j, collect ? protocolProgress(j) : null, this.waitingOf(j)), phase: protocolPhase(j) }
		// служебное состояние протокола наружу не отдаётся
		delete view.protocol
		return view
	}

	/** Чего ждёт `queued` кроме слота: паузу повтора (`retry`) или замок (`lock`); готовое к запуску — null. */
	private waitingOf(j: JobState): JobView['waiting'] {
		if (j.status !== 'queued') return null
		if (j.retryAt !== null && j.retryAt > this.deps.clock.now()) return 'retry'
		if (this.isWaiting(j) || this.queue.running().some(r => r.subject === j.subject)) return 'lock'
		return null
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
		return playbookView(approvePlaybook(ps, id, meanCorrections(p.cases, c => this.deps.store.readSummary(c))))
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
		const busy = this.queue.list().some(j => ((j.subject === id || j.subject === `edit:${id}`) && (j.status === 'queued' || j.status === 'running')) || (j.status === 'running' && this.playbookOfJob(j) === id))
		if (busy) throw new AppError(409, 'playbook_busy', `по плейбуку ${id} идёт задание, дождитесь его окончания`)
	}

	/** Плейбук, над которым работает задание (для замка): `review`, `edit:p-…`, `judge`/`improve` (из `payload.playbookId` или плейбука кейса). */
	private playbookOfJob(job: JobState): string | null {
		if (job.kind === 'review' && job.subject.startsWith('p-')) return job.subject
		if (job.kind === 'edit' && job.subject.startsWith('edit:p-')) return job.subject.slice('edit:'.length)
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
		this.pump()
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
		this.deps.store.writeSummary(id, '')
		this.update({ ...c, coveredUntil: 0, updatedAt: new Date(this.deps.clock.now()).toISOString() })
		return this.jobView(this.request('close', id, true))
	}

	/** Все незакрытые кейсы (сбор или ошибка) — на итоговый сбор. */
	runAll(): JobView[] {
		const open = [...this.cases.values()].filter(c => c.status === 'collecting' || c.status === 'error')
		return open.map(c => this.jobView(this.request('close', this.reopen(c).id, true)))
	}

	private assertIdle(caseId: string): void {
		if (this.queue.running().some(j => j.caseId === caseId)) throw new AppError(409, 'case_busy', `по кейсу ${caseId} идёт задание, дождитесь его окончания`)
	}

	/** Сессию подключили к вкладке (в том числе после `/resume`): подбираем события вне запроса хука. */
	onAttach(_sessionId: string): void {
		if (!this.loaded) return
		setImmediate(() => {
			if (this.stopped) return
			try {
				this.tick()
			} catch {
				/* сбой не должен ронять сервер */
			}
		}).unref()
	}

	/** Синхронно: собирает события всех цепочек, затем принимает решения. Ленту читает один раз за тик. */
	tick(): void {
		this.readSettings()
		this.checkStalls()
		// уже поставленные задания (повторы, ручные) идут и при выключенном обучении
		this.pump()
		if (!this.settings.enabled) return
		this.decay()
		this.scheduleTickAt(this.scan())
	}

	/**
	 * Отложенный `tick` (окно `TICK_DEBOUNCE_MS`): события шины и конец задания не плодят тиков.
	 * Без опроса (`tickMs` 0) не работает: тесты и вызывающий ведут `tick` сами.
	 */
	private requestTick(): void {
		if (this.stopped || this.deps.tickMs <= 0 || this.tickSoon) return
		this.tickSoon = setTimeout(() => {
			this.tickSoon = null
			if (this.stopped) return
			try {
				this.tick()
			} catch {
				/* сбой не должен ронять сервер */
			}
		}, TICK_DEBOUNCE_MS)
		this.tickSoon.unref()
	}

	/** `tick` в момент `at` (конец паузы сбора); раньше уже назначенного не откладывает. */
	private scheduleTickAt(at: number | null): void {
		if (this.stopped || this.deps.tickMs <= 0) return
		if (this.tickDue && (at === null || this.tickDue.at <= at)) return
		if (this.tickDue) clearTimeout(this.tickDue.timer)
		this.tickDue = null
		if (at === null) return
		const timer = setTimeout(() => {
			this.tickDue = null
			if (this.stopped) return
			try {
				this.tick()
			} catch {
				/* сбой не должен ронять сервер */
			}
		}, Math.max(0, at - this.deps.clock.now()))
		timer.unref()
		this.tickDue = { at, timer }
	}

	/** Просмотр цепочек и решения по кейсам; возвращает ближайший момент, когда кончится пауза сбора (или null). */
	private scan(): number | null {
		let due: number | null = null
		const { host, clock } = this.deps
		const sessions = host.sessions()
		const byId = new Map(sessions.map(s => [s.id, s]))
		const idx = this.caseIndex()
		const chains = new Map<string, string[]>()
		for (const s of sessions) {
			const chain = chainOf(sessions, s.id)
			const root = chain[0]
			if (root !== undefined && !chains.has(root)) chains.set(root, chain)
		}
		// собираются цепочки с кейсом и свежие (созданные после точки отсчёта); остальные не читаются вовсе
		const items: Array<{ root: string; chain: string[]; from: number }> = []
		for (const [root, chain] of chains) {
			if (chain.some(id => this.settings.disabledSessions.includes(id) || this.meta.removed.includes(id))) continue
			const c = this.caseForChain(chain, idx)
			if (c) items.push({ root, chain, from: c.feedSeq })
			else if (this.isFresh(chain, byId)) items.push({ root, chain, from: Math.max(this.scanned.get(root) ?? 0, this.meta.startSeq) })
		}
		if (!items.length) return null
		const messages = host.messagesSince(Math.min(...items.map(i => i.from)))
		const top = messages.reduce((max, m) => Math.max(max, m.seq), 0)
		const now = clock.now()
		for (const { root, chain, from } of items) {
			const c = this.collect(root, chain, messages, from, idx)
			if (!c) {
				// кейса нет: просмотренное повторно не читаем
				this.scanned.set(root, Math.max(from, top))
				continue
			}
			// `error` сам ничего не запускает (иначе шторм агентов при постоянной ошибке): только retry / run / rebuild
			if (c.status === 'error') continue
			const pending = c.events - c.coveredUntil
			const action = decide({ status: c.status, pending, lastRunAt: c.lastRunAt, lastEventAt: c.lastEventAt, busy: host.isBusy(chain), hasJob: this.hasJob(c.id) }, now, this.settings)
			if (action === 'none' && pending > 0 && !this.hasJob(c.id) && now - c.lastRunAt < COOLDOWN_MS) {
				const at = c.lastRunAt + COOLDOWN_MS
				due = due === null ? at : Math.min(due, at)
			}
			if (action === 'collect') {
				// закрытый кейс получил события: сессия вернулась
				if (c.status === 'ready') this.update({ ...c, status: 'collecting', closedAt: null, updatedAt: new Date(now).toISOString() })
				this.request('collect', c.id, false)
			} else if (action === 'close') {
				this.request('close', c.id, true)
			} else if (c.status === 'closing' && !this.hasJob(c.id)) {
				// `closing` без задания закрытия (потеряно при отмене или сбое) — самолечение: обратно в сбор
				this.reopenClosing(c.id)
			}
		}
		return due
	}

	/** Новые события одной цепочки: лента (только сообщения сессий цепочки) и транскрипты. Возвращает кейс цепочки (если есть). */
	private collect(root: string, chain: string[], messages: readonly Message[], fromSeq: number, idx?: ReadonlyMap<string, string>): CaseState | null {
		const { host, store, clock } = this.deps
		const existing = this.caseForChain(chain, idx)
		const id = existing?.id ?? caseIdOf(root)
		const now = clock.now()
		const iso = new Date(now).toISOString()
		const base: CaseState = existing ?? {
			id,
			title: null,
			sessions: [],
			status: 'collecting',
			goals: [],
			events: 0,
			coveredUntil: 0,
			createdAt: iso,
			updatedAt: iso,
			closedAt: null,
			playbook: null,
			source: 'live',
			feedSeq: fromSeq,
			transcripts: {},
			nextN: 1,
			lastEventAt: 0,
			rootId: root,
			// начало кейса — точка отсчёта паузы `COOLDOWN_MS`: всплеск первых событий уходит в один первый сбор
			lastRunAt: now,
			nessyCalls: false,
			hinted: [],
		}
		const inChain = new Set(chain)
		const unseen = messages.filter(m => m.seq > base.feedSeq)
		const mine = unseen.filter(m => {
			const s = host.sessionOfMessage(m)
			return s !== null && inChain.has(s)
		})
		const byId = new Map(host.sessions().map(s => [s.id, s]))
		const transcripts: Array<{ chatId: string; text: string; next: TranscriptCursor }> = []
		for (const sid of chain) {
			const s = byId.get(sid)
			// чужие файлы (не из каталога проектов Claude Code, не .jsonl) не читаем
			if (!s?.transcriptPath || !store.isAllowedTranscript(s.transcriptPath, this.deps.claudeProjectsDir)) continue
			const key = s.chatId ?? sid
			const prev = base.transcripts[key]
			const cur: TranscriptCursor = prev && prev.path === s.transcriptPath ? prev : { path: s.transcriptPath, offset: 0 }
			const r = store.copyTranscript(id, key, cur)
			if (r.text || r.next.offset !== cur.offset || r.next.path !== prev?.path) transcripts.push({ chatId: key, text: r.text, next: r.next })
		}
		const { events, state } = ingest(base, { messages: mine, transcripts, playbookVersion: this.playbookVersion })
		if (!events.length && !existing) return null
		const maxSeen = unseen.reduce((max, m) => Math.max(max, m.seq), state.feedSeq)
		const touched = chain.reduce((max, sid) => Math.max(max, Date.parse(byId.get(sid)?.updatedAt ?? '') || 0), state.lastEventAt)
		// название кейса — название сессии (последней в цепочке); Claude меняет его позже, поэтому обновляется на каждом тике
		const sessionTitle = byId.get(chain[chain.length - 1] ?? '')?.title.trim() ?? ''
		const title = sessionTitle !== '' ? sessionTitle : state.title
		const next: CaseState = {
			...state,
			title,
			feedSeq: maxSeen,
			sessions: chain,
			rootId: base.rootId ?? root,
			lastEventAt: touched,
			updatedAt: events.length || chain.join() !== base.sessions.join() || title !== base.title ? iso : base.updatedAt,
		}
		// не записалось — курсоры ленты и транскриптов не двигаем: следующий тик повторит
		if (events.length && !store.appendRaw(id, events)) {
			this.log('error', id, `«${next.title ?? id}»: не удалось записать события на диск, повторю на следующем тике`)
			return existing
		}
		this.update(next)
		if (!existing) this.log('info', id, `Новая сессия «${this.sessionTitle(id)}»: начат сбор`)
		return next
	}

	/** Сохраняет и публикует кейс, если что-то изменилось. */
	private update(next: CaseState): void {
		const prev = this.cases.get(next.id)
		if (prev && JSON.stringify(prev) === JSON.stringify(next)) return
		this.cases.set(next.id, next)
		this.deps.store.saveCase(next)
		if (!prev || JSON.stringify(toView(prev)) !== JSON.stringify(toView(next))) this.deps.hub.publish({ t: 'learning_case', case: toView(next) })
	}

	private readSettings(): void {
		const mtime = this.deps.store.settingsMtime()
		if (mtime === this.settingsMtime) return
		const { raw, mtimeMs } = this.deps.store.loadSettings()
		const was = this.settings.enabled
		this.settings = raw === undefined ? parseLearningSettings({ enabled: this.deps.defaultOn }) : parseLearningSettings(raw)
		this.settingsMtime = mtimeMs
		if (this.loaded && this.settings.enabled !== was) this.log('info', '', this.settings.enabled ? 'Фоновое обучение включено (настройки изменены в файле)' : 'Фоновое обучение выключено (настройки изменены в файле)')
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
		const found = this.findCase(sessionOrCaseId, true)
		if (!found) throw new AppError(404, 'no_case', `нет кейса или сессии ${sessionOrCaseId}`)
		const c = this.reopen(found)
		return this.jobView(this.request('close', c.id, true))
	}

	/** Вкладку закрыли: сразу собираем итоговое описание. Выключено (в целом или для сессии) — молчим. */
	onSessionClosed(sessionId: string): void {
		this.readSettings()
		if (!this.settings.enabled) return
		// отключённой сессии (и всей её цепочки) кейс не заводим
		if (chainOf(this.deps.host.sessions(), sessionId).some(id => this.settings.disabledSessions.includes(id) || this.meta.removed.includes(id))) return
		const c = this.findCase(sessionId, false)
		if (!c || c.sessions.some(id => this.settings.disabledSessions.includes(id))) return
		this.request('close', c.id, true)
	}

	/** Ручной повтор упавшего задания. */
	retry(jobId: string): JobView {
		const job = this.queue.retry(jobId)
		const c = this.cases.get(job.caseId)
		if (c && c.status === 'error') this.update({ ...c, status: job.kind === 'close' ? 'closing' : 'collecting', closedAt: null, updatedAt: new Date(this.deps.clock.now()).toISOString() })
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

	/**
	 * Кейс по id или по сессии; для живой сессии сначала подбирает свежие события (кейс может ещё не существовать).
	 * `manual` — ручной запуск: кейс заводится и для старой сессии (лента с начала), надгробие снимается;
	 * иначе кейс заводится только для свежей (после точки отсчёта) цепочки, ленту читаем с точки отсчёта.
	 */
	private findCase(idOrSession: string, manual: boolean): CaseState | null {
		const direct = this.cases.get(idOrSession)
		if (direct) return direct
		const { host } = this.deps
		const sessions = host.sessions()
		if (sessions.some(s => s.id === idOrSession)) {
			const chain = chainOf(sessions, idOrSession)
			const root = chain[0]
			if (root !== undefined) {
				const have = this.caseForChain(chain)
				if (!have && manual) this.untomb(chain)
				if (have || manual || this.isFresh(chain, new Map(sessions.map(s => [s.id, s])))) {
					const from = have ? have.feedSeq : manual ? 0 : Math.max(this.scanned.get(root) ?? 0, this.meta.startSeq)
					const c = this.collect(root, chain, host.messagesSince(from), from)
					if (c) return c
				}
			}
		}
		return [...this.cases.values()].find(c => c.sessions.includes(idOrSession)) ?? null
	}

	private jobsChanged(job: JobState): void {
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_job', job: this.jobView(job) })
		for (const merged of this.queue.takeAbsorbed()) this.deps.hub.publish({ t: 'learning_job', job: this.jobView(merged) })
	}

	/**
	 * Насос: пока есть место (`maxAgents`) и готовое задание — запускает, синхронно и сразу (из `enqueue`, конца задания, смены настроек).
	 * Повторы с `retryAt` и сторожевые сроки будит таймер на ближайший срок (unref) и каждый `tick`.
	 */
	private pump(): void {
		if (this.stopped || this.pumping) return
		this.pumping = true
		try {
			for (;;) {
				if (this.queue.running().length >= this.settings.maxAgents) break
				const job = this.queue.next(this.deps.clock.now(), j => this.isWaiting(j))
				if (!job) break
				this.launch(job)
			}
		} finally {
			this.pumping = false
		}
		this.scheduleWake()
	}

	/** Таймер на ближайший срок: конец паузы повтора или истечение сторожа идущего задания. */
	private scheduleWake(): void {
		if (this.wake) clearTimeout(this.wake)
		this.wake = null
		if (this.stopped) return
		const now = this.deps.clock.now()
		const due = this.queue.list().flatMap(j => {
			if (j.status === 'queued' && j.retryAt !== null && j.retryAt > now) return [j.retryAt]
			if (j.status === 'running') return [(j.activityAt ?? now) + stallMs(j)]
			return []
		})
		if (!due.length) return
		this.wake = setTimeout(() => {
			this.wake = null
			this.checkStalls()
			this.pump()
		}, Math.max(0, Math.min(...due) - now))
		this.wake.unref()
	}

	/** Сторож: идущие задания без активности `JOB_STALL_MS` снимаются. */
	private checkStalls(): void {
		const now = this.deps.clock.now()
		for (const j of this.queue.running()) {
			if (j.activityAt === undefined || j.activityAt === null) j.activityAt = now
			else if (now - j.activityAt >= stallMs(j)) this.stall(j)
		}
	}

	/**
	 * Зависшее задание: агент отменяется, итог прежнего запуска игнорируется, слот свободен;
	 * задание — провал (попытка++, пауза), а остановленное пользователем — `done`.
	 */
	private stall(job: JobState): void {
		this.runGen.delete(job.id)
		if (job.agentId) void this.deps.host.cancelAgent(job.agentId).catch(() => undefined)
		if (this.cancelled.has(job.id)) return this.finishCancelled(job)
		this.failNow(job, `нет активности ${Math.round(stallMs(job) / 60_000)} мин: агент снят`, true)
	}

	private launch(queued: JobState): void {
		const job = this.queue.start(queued.id, null)
		this.log('info', job.subject, `${this.jobLabel(job)}: агент запущен, попытка ${job.attempts + 1}`)
		const gen = ++this.genSeq
		this.runGen.set(job.id, gen)
		try {
			const c = this.cases.get(job.caseId)
			if (c && job.kind === 'close' && c.status !== 'closing') this.update({ ...c, status: 'closing', updatedAt: new Date(this.deps.clock.now()).toISOString() })
			this.jobsChanged(job)
		} catch {
			/* запись на диск не удалась: задание всё равно идёт, иначе слот завис бы в `running` без исполнителя */
		}
		const run = this.execute(job, gen)
			.catch((e: unknown) => this.fail(job, e instanceof Error ? e.message : String(e), gen))
			.finally(() => {
				this.inflight.delete(run)
				if (this.runGen.get(job.id) === gen) this.runGen.delete(job.id)
				this.pump()
				// конец запуска сдвигает `lastRunAt`: события, пришедшие за время работы, не ждут опроса
				this.requestTick()
			})
		this.inflight.add(run)
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
			this.jobsChanged(this.queue.cancel(job.id, CANCELLED))
			this.reopenClosing(job.caseId)
		}
		this.cancelled.delete(job.id)
	}

	private finishJob(job: JobState, note?: string): void {
		if (note !== undefined) job.note = note
		const took = job.startedAt ? fmtDuration(this.deps.clock.now() - Date.parse(job.startedAt)) : null
		this.log('info', job.subject, `${this.jobLabel(job)}: готово${took ? ` за ${took}` : ''}${note ? ` (${note})` : ''}`)
		this.queue.finish(job.id)
		this.jobsChanged(job)
	}

	private context(job: JobState, gen: number): JobContext {
		const { store, host, clock } = this.deps
		// порядковый номер вызова агента в задании: несколько агентов не затирают ответы друг друга
		let calls = 0
		return {
			job,
			now: () => clock.now(),
			settings: () => this.settings,
			runAgent: async (name, title, prompt) => {
				if (this.cancelled.has(job.id)) throw new Error(CANCELLED)
				// новый вызов агента — активность (сторожевой таймер считается от него)
				this.queue.touch(job.id)
				job.title = title
				const res = await host.runAgent({
					name,
					title,
					prompt,
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
				calls += 1
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
				seal: id => this.seal(id),
			},
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

	/** Задание снова в очереди с паузой `min(5 с × 2^(попытка−1), 2 мин)`, кейс в `error` не переходит. */
	private failNow(job: JobState, error: string, stalled = false): void {
		const j = this.queue.fail(job.id, error)
		const pause = j.retryAt === null ? '' : `; повтор через ${fmtDuration(j.retryAt - this.deps.clock.now())}`
		this.log('warn', j.subject, stalled ? `${this.jobLabel(j)}: ${error}${pause}` : `${this.jobLabel(j)}: не удалось: ${error}${pause}`)
		// провал любой попытки сборки: пока она повторяется или окончательно упала, `match` не ставит ту же группу заново
		if (j.kind === 'build') this.rememberFailedBuild(j)
		this.jobsChanged(j)
	}

	/** Провал сборки: `{ hash, cases, at }` в `meta.json` (старше суток записи отбрасываются). */
	private rememberFailedBuild(job: JobState): void {
		const raw: unknown = job.payload?.['cases']
		const found = new Set<string>()
		if (Array.isArray(raw)) for (const e of raw as unknown[]) if (typeof e === 'object' && e !== null && 'caseId' in e && typeof e.caseId === 'string') found.add(e.caseId)
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
	private seal(caseId: string): void {
		const c = this.cases.get(caseId)
		if (!c) return
		const iso = new Date(this.deps.clock.now()).toISOString()
		if (c.events === 0 && this.deps.store.readSummary(caseId).trim() === '') {
			this.log('info', caseId, `Сессия «${this.sessionTitle(caseId)}»: событий нет, кейс убран`)
			this.cases.delete(caseId)
			this.queue.removeCase(caseId)
			this.deps.store.removeCase(caseId)
			this.deps.store.saveJobs(this.queue.list())
			this.deps.hub.publish({ t: 'learning_case_removed', id: caseId })
			return
		}
		this.update({ ...c, status: 'ready', closedAt: iso, updatedAt: iso })
		this.log('info', caseId, `Сессия «${this.sessionTitle(caseId)}» обработана: ${c.events} ${plural(c.events, 'событие', 'события', 'событий')}, ${c.goals.length} ${plural(c.goals.length, 'цель', 'цели', 'целей')}`)
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
