import type { BackfillCandidate, BackfillResult, CaseDetail, CaseView, JobKind, JobView, LearningSettings, LearningView, Message, SessionView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { decide } from '../../domain/learning-schedule'
import { parseLearningSettings, patchLearningSettings } from '../../domain/learning-settings'
import { caseIdOf, chainOf, ingest } from './case-ingest'
import { onCaseReady } from './case-ready'
import { collectHandler } from './collect.handler'
import type { JobContext, JobHandler } from './handlers.types'
import { JobQueue } from './job-queue'
import { PlaybookService, playbookView } from './playbook.service'
import type { CaseState, EnqueueOpts, JobState, LearningDeps, LearningMeta, TranscriptCursor } from './learning.types'

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
	/** пачки бэкфилла: кейс → все кейсы его пачки (только в памяти; выдаётся один раз при `ready`, см. `onCaseReady`) */
	private readonly batches = new Map<string, string[]>()
	/** плейбуки; null без `deps.playbookStore` — тогда сервис работает как на этапе 1 */
	readonly playbooks: PlaybookService | null

	constructor(private readonly deps: LearningDeps) {
		this.settings = parseLearningSettings({ enabled: deps.defaultOn })
		this.queue = new JobQueue({ ids: deps.ids, now: () => deps.clock.now() })
		this.playbooks = deps.playbookStore
			? new PlaybookService({ store: deps.playbookStore, hub: deps.hub, clock: deps.clock, ids: deps.ids, pluginVersion: deps.pluginVersion, caseOf: id => this.cases.get(id) ?? null })
			: null
		this.registerHandler(collectHandler)
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

	/** Кейс с описанием и заметками. */
	getCaseDetail(id: string): CaseDetail {
		const c = this.getCase(id)
		return { ...toView(c), summary: this.deps.store.readSummary(id), notes: this.deps.store.readNotes(id) }
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
		// надгробие: живая сессия этого кейса заново его не заведёт
		this.tomb([c.rootId ?? c.sessions[0] ?? '', ...c.sessions])
		this.cases.delete(id)
		this.queue.removeCase(id)
		this.deps.store.removeCase(id)
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_case_removed', id })
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
		for (const id of batch) this.batches.set(id, batch)
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

	/** Задание ждёт кейсы из `payload.after`, пока они не `ready`/`error`. */
	private isWaiting(job: JobState): boolean {
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
		return {
			job,
			now: () => clock.now(),
			settings: () => this.settings,
			runAgent: async (name, title, prompt) => {
				const res = await host.runAgent({ name, title, prompt })
				job.agentId = res.agentId
				// агент после ответа удаляется: ответ остаётся в cases/<subject>/runs/
				if (res.text) store.writeRun(job.subject, job.id, res.text)
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
				seal: id => this.seal(id),
			},
			playbooks: this.playbooks,
			enqueue: (kind, subject, opts) => void this.enqueue(kind, subject, opts),
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
		this.jobsChanged(j)
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
					batch: id => {
						const b = this.batches.get(id) ?? null
						this.batches.delete(id)
						return b
					},
				},
				caseId,
			)
		}
	}
}
