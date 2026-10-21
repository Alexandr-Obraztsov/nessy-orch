import type { CaseImpact, ChatMessage, JobDetail, JournalEntry, PlaybookDetail, PlaybookPatch, PlaybookStatus, PlaybookView } from '../../../shared/types'
import type { BackfillCandidate, BackfillResult, CaseDetail, CaseView, JobKind, JobView, LearningSettings, LearningView, Message, RawEvent, SessionView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { decide } from '../../domain/learning-schedule'
import { parseLearningSettings, patchLearningSettings } from '../../domain/learning-settings'
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
import type { CaseState, EnqueueOpts, FailedBuild, JobState, LearningDeps, LearningMeta, TranscriptCursor } from './learning.types'
import { recount } from '../../domain/rule-counters'

/** Сколько после окончательного провала сборки `match` не повторяет ту же группу. */
const FAILED_BUILD_MS = 24 * 3600 * 1000
/** Сколько событий отдаёт `GET /learning/cases/:id/raw`. */
const RAW_LIMIT = 500
/** Как часто пересчитываются счётчики правил (затухание). */
const RECOUNT_MS = 24 * 3600 * 1000

/** id кейса транскрипта прошлого чата; имя безопасно для пути. */
export const transcriptCaseId = (chatId: string): string => `c-t-${chatId.replace(/[^\w-]/g, '_')}`

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
	source: c.source,
})

/** Фоновое обучение: события сессий (с учётом цепочки `/clear`) собираются в кейсы, кейсам назначаются задания. */
export class LearningService {
	private readonly cases = new Map<string, CaseState>()
	private settings: LearningSettings
	private settingsMtime = -1
	private loaded = false
	private readonly queue: JobQueue
	private stopped = false
	private pumping = false
	private ticker: NodeJS.Timeout | null = null
	private wake: NodeJS.Timeout | null = null
	/** идущие исполнения заданий: `stop()` ждёт их */
	private readonly inflight = new Set<Promise<void>>()
	/** задания, прерванные `stop()`: их поздние итоги игнорируются */
	private readonly interrupted = new Set<string>()
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
		// после рестарта `running` вернулись в очередь: фиксируем это на диске
		if (jobs.some(j => j.status === 'running')) this.deps.store.saveJobs(this.queue.list())
		this.readSettings()
		this.loaded = true
	}

	/** Запуск: насос сразу (задания после рестарта) и таймер `tick` раз в `tickMs` (0 — без таймера). */
	start(): void {
		this.stopped = false
		this.pump()
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
		if (this.ticker) clearInterval(this.ticker)
		if (this.wake) clearTimeout(this.wake)
		this.ticker = null
		this.wake = null
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
			this.jobsChanged(this.queue.requeue(j.id, 'прервано остановкой'))
		}
	}

	getSettings(): LearningSettings {
		return this.settings
	}

	view(): LearningView {
		const cases = [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toView)
		return { settings: this.settings, jobs: this.queue.list().map(j => this.queue.toView(j)), cases, playbooks: this.playbooks?.list().map(playbookView) ?? [], journal: this.playbooks?.journal(200) ?? [] }
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
		return { job: this.queue.toView(job), runs: this.deps.store.readRuns(job.subject, job.id) }
	}

	/** События кейса `from..to` (включительно), не больше `RAW_LIMIT`: якорь «открыть место в сессии». */
	caseRaw(id: string, from: number, to?: number): RawEvent[] {
		this.getCase(id)
		return this.deps.store.readRaw(id, from, to).slice(0, RAW_LIMIT)
	}

	/** Правка описания руками: `summary.md` целиком, курсор сборщика не трогается; пока по кейсу идёт задание — 409 `case_busy`. */
	setCaseSummary(id: string, text: string): void {
		this.getCase(id)
		this.assertIdle(id)
		if (!this.deps.store.writeSummary(id, text)) throw new AppError(500, 'write_failed', 'не удалось записать summary.md')
	}

	/**
	 * Остановить сборщика кейса: `queued` снимаются, `running` прерывается (агент отменяется, итог игнорируется).
	 * Потом кейс `ready`, если есть описание, иначе удаляется. Нет заданий сборки — ничего не меняется.
	 */
	stopCollector(id: string): void {
		this.getCase(id)
		const jobs = this.queue.list().filter(j => j.caseId === id && (j.kind === 'collect' || j.kind === 'close') && (j.status === 'queued' || j.status === 'running'))
		if (!jobs.length) return
		for (const j of jobs) {
			if (j.status === 'running') {
				this.interrupted.add(j.id)
				if (j.agentId) void this.deps.host.cancelAgent(j.agentId).catch(() => undefined)
			}
			this.jobsChanged(this.queue.cancel(j.id, 'остановлено пользователем'))
		}
		const c = this.cases.get(id)
		if (!c) return
		if (this.deps.store.readSummary(id).trim() === '') this.dropCase(c)
		else this.seal(id)
		this.pump()
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
	 * критичные замечания `lintPlaybook` (не строгие к доказательствам) — 400 `lint`.
	 */
	patchPlaybook(id: string, patch: PlaybookPatch): PlaybookView {
		const ps = this.pb()
		const p = ps.need(id)
		this.assertPlaybookIdle(id)
		const next = applyPatch(p, patch, new Date(this.deps.clock.now()).toISOString())
		const known = new Set(this.cases.keys())
		const critical = lintPlaybook(next, renderPlaybook(next, ps.notes(id), ''), known, { strictEvidence: false }).filter(i => i.level === 'critical')
		if (critical.length) throw new AppError(400, 'lint', critical.map(i => `${i.where}: ${i.text}`).join('\n'))
		const fields = Object.keys(patch).join(', ')
		return playbookView(ps.saveVersion(next, `Edited by the user: ${fields}`, { kind: 'edit', subject: id, summary: `${id}: правка блоками (${fields})`, report: null, revertible: true, revertedBy: null }))
	}

	/** Кейс с описанием и заметками. */
	getCaseDetail(id: string): CaseDetail {
		const c = this.getCase(id)
		return { ...toView(c), summary: this.deps.store.readSummary(id), notes: this.deps.store.readNotes(id) }
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
		return this.queue.toView(this.enqueue('review', id))
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

	journal(limit = 200): JournalEntry[] {
		return this.pb().journal(limit)
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
		// надгробие: живая сессия этого кейса заново его не заведёт
		this.tomb([c.rootId ?? c.sessions[0] ?? '', ...c.sessions])
		this.cases.delete(id)
		this.takeBatch(id)
		this.queue.removeCase(id)
		this.deps.store.removeCase(id)
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_case_removed', id })
	}

	private saveMeta(next: LearningMeta): void {
		this.meta = next
		this.deps.store.saveMeta(next)
	}

	/** Пачка бэкфилла кейса выдаётся один раз и стирается из `meta.json`. */
	private takeBatch(caseId: string): string[] | null {
		const batch = this.meta.batches?.[caseId] ?? null
		if (batch === null) return null
		const { [caseId]: _taken, ...rest } = this.meta.batches ?? {}
		this.saveMeta({ ...this.meta, batches: rest })
		return batch
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
		return this.queue.toView(this.request('close', id, true))
	}

	/** Все незакрытые кейсы (сбор или ошибка) — на итоговый сбор. */
	runAll(): JobView[] {
		const open = [...this.cases.values()].filter(c => c.status === 'collecting' || c.status === 'error')
		return open.map(c => this.queue.toView(this.request('close', this.reopen(c).id, true)))
	}

	private assertIdle(caseId: string): void {
		if (this.queue.running().some(j => j.caseId === caseId)) throw new AppError(409, 'case_busy', `по кейсу ${caseId} идёт задание, дождитесь его окончания`)
	}

	/**
	 * Что можно разобрать задним числом: сессии без кейса, у которых в ленте есть сообщения (размер — число сообщений),
	 * и транскрипты Claude Code с вызовами nessy-orch (размер — байты), кроме чатов сессий и уже взятых в кейсы.
	 */
	backfillCandidates(): BackfillCandidate[] {
		const { host, store, claudeProjectsDir } = this.deps
		const sessions = host.sessions()
		const known = new Set<string>()
		for (const s of sessions) if (s.chatId) known.add(s.chatId)
		for (const c of this.cases.values()) for (const key of Object.keys(c.transcripts)) known.add(key)
		const perSession = new Map<string, number>()
		for (const m of host.messagesSince(0)) {
			const sid = host.sessionOfMessage(m)
			if (sid !== null) perSession.set(sid, (perSession.get(sid) ?? 0) + 1)
		}
		const byId = new Map(sessions.map(s => [s.id, s]))
		const roots = new Set<string>()
		const idx = this.caseIndex()
		const out: BackfillCandidate[] = []
		for (const s of sessions) {
			const chain = chainOf(sessions, s.id)
			const root = chain[0]
			if (root === undefined || roots.has(root)) continue
			roots.add(root)
			if (this.caseForChain(chain, idx)) continue
			const size = chain.reduce((n, id) => n + (perSession.get(id) ?? 0), 0)
			if (size === 0) continue
			const date = chain.reduce((max, id) => (byId.get(id)?.updatedAt ?? '') > max ? (byId.get(id)?.updatedAt ?? '') : max, '')
			out.push({ kind: 'session', id: root, title: byId.get(root)?.title ?? root, date, size })
		}
		out.push(...store.scanTranscripts(claudeProjectsDir, known))
		return out.sort((a, b) => b.date.localeCompare(a.date))
	}

	/**
	 * Заводит кейсы `source: 'backfill'` и ставит каждому итоговое задание `close`.
	 * Неизвестный id — 404 `no_candidate` до любых изменений; кейс, который уже есть, пропускается (`skipped`), дубля нет.
	 */
	backfill(ids: readonly string[]): BackfillResult {
		const list = this.backfillCandidates()
		const picked: BackfillCandidate[] = []
		const skipped: BackfillResult['skipped'] = []
		for (const id of new Set(ids)) {
			const cand = list.find(c => c.id === id)
			if (cand) {
				picked.push(cand)
				continue
			}
			if (this.caseForChain(chainOf(this.deps.host.sessions(), id)) || this.cases.has(transcriptCaseId(id))) skipped.push({ id, reason: 'кейс уже есть' })
			else throw new AppError(404, 'no_candidate', `${id} нет среди кандидатов разбора`)
		}
		const created: CaseView[] = []
		for (const cand of picked) {
			const c = cand.kind === 'session' ? this.backfillSession(cand.id) : this.backfillTranscript(cand.id)
			if (!c) {
				skipped.push({ id: cand.id, reason: cand.kind === 'session' ? 'нет событий' : 'транскрипт не найден' })
				continue
			}
			// сразу итоговое описание: без ожидания интервала
			this.update({ ...c, lastRunAt: 0 })
			this.request('close', c.id, true)
			created.push(toView(this.getCase(c.id)))
		}
		// пачка: сопоставитель после неё запускается один раз (`payload.after` у `match`)
		const batch = created.map(c => c.id)
		if (batch.length) this.saveMeta({ ...this.meta, batches: { ...this.meta.batches, ...Object.fromEntries(batch.map(id => [id, batch])) } })
		return { created, skipped }
	}

	private backfillSession(rootId: string): CaseState | null {
		const chain = chainOf(this.deps.host.sessions(), rootId)
		// разбор прошлого — явное желание пользователя: надгробие снимается
		this.untomb(chain)
		this.collect(rootId, chain, this.deps.host.messagesSince(0), 'backfill', 0)
		return this.caseForChain(chain)
	}

	/** Кейс прошлого чата: без сессий, транскрипт читается целиком, вызовы nessy-orch идут событиями `call`. */
	private backfillTranscript(chatId: string): CaseState | null {
		const { store, clock, claudeProjectsDir } = this.deps
		const file = store.findTranscript(claudeProjectsDir, chatId)
		if (file === null) return null
		const id = transcriptCaseId(chatId)
		const iso = new Date(clock.now()).toISOString()
		const base: CaseState = {
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
			source: 'backfill',
			feedSeq: 0,
			transcripts: {},
			nextN: 1,
			lastEventAt: 0,
			lastRunAt: 0,
			nessyCalls: true,
			hinted: [],
		}
		const r = store.copyTranscript(id, chatId, { path: file, offset: 0 })
		const { events, state } = ingest(base, { messages: [], transcripts: [{ chatId, text: r.text, next: r.next }], playbookVersion: this.playbookVersion })
		if (events.length && !store.appendRaw(id, events)) return null
		this.update(state)
		return state
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
		// уже поставленные задания (повторы, ручные) идут и при выключенном обучении
		this.pump()
		if (!this.settings.enabled) return
		this.decay()
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
		if (!items.length) return
		const messages = host.messagesSince(Math.min(...items.map(i => i.from)))
		const top = messages.reduce((max, m) => Math.max(max, m.seq), 0)
		const now = clock.now()
		for (const { root, chain, from } of items) {
			const c = this.collect(root, chain, messages, 'live', from, idx)
			if (!c) {
				// кейса нет: просмотренное повторно не читаем
				this.scanned.set(root, Math.max(from, top))
				continue
			}
			// `error` сам ничего не запускает (иначе шторм агентов при постоянной ошибке): только retry / run / rebuild
			if (c.status === 'error') continue
			const pending = c.events - c.coveredUntil
			const action = decide({ status: c.status, pending, lastRunAt: c.lastRunAt, lastEventAt: c.lastEventAt, busy: host.isBusy(chain), hasJob: this.hasJob(c.id) }, now, this.settings)
			if (action === 'collect') {
				// закрытый кейс получил события: сессия вернулась
				if (c.status === 'ready') this.update({ ...c, status: 'collecting', closedAt: null, updatedAt: new Date(now).toISOString() })
				this.request('collect', c.id, false)
			} else if (action === 'close') {
				this.request('close', c.id, true)
			}
		}
	}

	/** Новые события одной цепочки: лента (только сообщения сессий цепочки) и транскрипты. Возвращает кейс цепочки (если есть). */
	private collect(root: string, chain: string[], messages: readonly Message[], source: CaseView['source'], fromSeq: number, idx?: ReadonlyMap<string, string>): CaseState | null {
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
			source,
			feedSeq: fromSeq,
			transcripts: {},
			nextN: 1,
			lastEventAt: 0,
			rootId: root,
			// новый кейс первый раз собирается по интервалу или по 15 событиям, а не сразу
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
		const next: CaseState = {
			...state,
			feedSeq: maxSeen,
			sessions: chain,
			rootId: base.rootId ?? root,
			lastEventAt: touched,
			updatedAt: events.length || chain.join() !== base.sessions.join() ? iso : base.updatedAt,
		}
		// не записалось — курсоры ленты и транскриптов не двигаем: следующий тик повторит
		if (events.length && !store.appendRaw(id, events)) return existing
		this.update(next)
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
		this.settings = raw === undefined ? parseLearningSettings({ enabled: this.deps.defaultOn }) : parseLearningSettings(raw)
		this.settingsMtime = mtimeMs
	}

	private request(kind: JobKind, caseId: string, final: boolean): JobState {
		return this.enqueue(kind, caseId, { caseId, final })
	}

	private enqueue(kind: JobKind, subject: string, opts: EnqueueOpts = {}): JobState {
		const job = this.queue.enqueue(kind, subject, opts)
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

	/** Задание ждёт кейсы из `payload.after`, пока они не `ready`/`error`. */
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
		const after = job.payload?.['after']
		if (!Array.isArray(after)) return false
		return after.some(id => {
			const c = typeof id === 'string' ? this.cases.get(id) : undefined
			return c !== undefined && c.status !== 'ready' && c.status !== 'error'
		})
	}

	private hasJob(caseId: string): boolean {
		return this.queue.hasJob(caseId)
	}

	/** Ручной «Собрать кейс сейчас»: задание `close` по кейсу или по сессии; работает и при выключенном обучении. */
	runNow(sessionOrCaseId: string): JobView {
		const found = this.findCase(sessionOrCaseId, true)
		if (!found) throw new AppError(404, 'no_case', `нет кейса или сессии ${sessionOrCaseId}`)
		const c = this.reopen(found)
		return this.queue.toView(this.request('close', c.id, true))
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
		return this.queue.toView(job)
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
					const c = this.collect(root, chain, host.messagesSince(from), 'live', from)
					if (c) return c
				}
			}
		}
		return [...this.cases.values()].find(c => c.sessions.includes(idOrSession)) ?? null
	}

	private jobsChanged(job: JobState): void {
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_job', job: this.queue.toView(job) })
	}

	/**
	 * Насос: пока есть место (`maxAgents`) и готовое задание — запускает.
	 * Повторы с `retryAt` будит таймер на ближайший срок (unref) и каждый `tick`.
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

	private scheduleWake(): void {
		if (this.wake) clearTimeout(this.wake)
		this.wake = null
		if (this.stopped) return
		const now = this.deps.clock.now()
		const due = this.queue.list().flatMap(j => (j.status === 'queued' && j.retryAt !== null && j.retryAt > now ? [j.retryAt] : []))
		if (!due.length) return
		this.wake = setTimeout(() => {
			this.wake = null
			this.pump()
		}, Math.min(...due) - now)
		this.wake.unref()
	}

	private launch(queued: JobState): void {
		const job = this.queue.start(queued.id, null)
		const c = this.cases.get(job.caseId)
		if (c && job.kind === 'close' && c.status !== 'closing') this.update({ ...c, status: 'closing', updatedAt: new Date(this.deps.clock.now()).toISOString() })
		this.jobsChanged(job)
		const run = this.execute(job)
			.catch((e: unknown) => this.fail(job, e instanceof Error ? e.message : String(e)))
			.finally(() => {
				this.inflight.delete(run)
				this.pump()
			})
		this.inflight.add(run)
	}

	/** Исполнение задания обработчиком своего вида; исключение — провал, нет обработчика — окончательный провал без повторов. */
	private async execute(job: JobState): Promise<void> {
		const handler = this.handlers.get(job.kind)
		if (!handler) return this.fail(job, `нет обработчика задания ${job.kind}`, true)
		await handler.run(this.context(job))
		if (this.interrupted.has(job.id)) return
		// обработчик мог завершить задание сам (сбор: до постановки следующего)
		if (job.status === 'running') this.finishJob(job)
	}

	private finishJob(job: JobState, note?: string): void {
		if (note !== undefined) job.note = note
		this.queue.finish(job.id)
		this.jobsChanged(job)
	}

	private context(job: JobState): JobContext {
		const { store, host, clock } = this.deps
		// порядковый номер вызова агента в задании: несколько агентов не затирают ответы друг друга
		let calls = 0
		return {
			job,
			now: () => clock.now(),
			settings: () => this.settings,
			runAgent: async (name, title, prompt) => {
				const res = await host.runAgent({
					name,
					title,
					prompt,
					// id агента известен сразу: «Остановить» и живой чат в приложении работают, пока агент идёт
					onSpawn: agentId => {
						job.agentId = agentId
						this.jobsChanged(job)
						if (this.interrupted.has(job.id)) void host.cancelAgent(agentId).catch(() => undefined)
					},
				})
				job.agentId = res.agentId
				// агент после ответа удаляется: ответ остаётся в runs/ (см. `LearningStorePort.writeRun`)
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
				seal: id => this.seal(id),
			},
			failedBuilds: () => this.recentFailedBuilds(),
			playbooks: this.playbooks,
			hints: this.hints,
			enqueue: (kind, subject, opts) => void this.enqueue(kind, subject, opts),
			chat: (subject, text, changes) => void this.addChat(subject, 'agent', text, changes),
			finish: note => this.finishJob(job, note),
			changed: () => this.jobsChanged(job),
		}
	}

	/** Провал: повтор или `error`; окончательный провал задания (collect или close) переводит кейс в `error`. */
	private fail(job: JobState, error: string, terminal = false): void {
		if (this.interrupted.has(job.id)) return
		const j = this.queue.fail(job.id, error, terminal ? 0 : 2)
		if (j.status === 'error' && (j.kind === 'collect' || j.kind === 'close')) {
			const c = this.cases.get(j.caseId)
			// пауза до следующей автоматической попытки считается от провала
			if (c) this.update({ ...c, status: 'error', lastRunAt: this.deps.clock.now(), updatedAt: new Date(this.deps.clock.now()).toISOString() })
		}
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
			this.cases.delete(caseId)
			this.queue.removeCase(caseId)
			this.deps.store.removeCase(caseId)
			this.deps.store.saveJobs(this.queue.list())
			this.deps.hub.publish({ t: 'learning_case_removed', id: caseId })
			return
		}
		this.update({ ...c, status: 'ready', closedAt: iso, updatedAt: iso })
		// судья и сопоставитель — только при плейбуках
		if (this.playbooks) {
			onCaseReady(
				{
					cases: { get: id => this.cases.get(id) ?? null },
					enqueue: (kind, subject, opts) => void this.enqueue(kind, subject, opts),
					batch: id => this.takeBatch(id),
				},
				caseId,
			)
		}
	}
}
