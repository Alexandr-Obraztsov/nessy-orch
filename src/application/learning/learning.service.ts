import type { BackfillCandidate, BackfillResult, CaseDetail, CaseView, JobKind, JobView, LearningSettings, LearningView, Message } from '../../../shared/types'
import { renderPortion } from '../../domain/case-events'
import { buildCollectorPrompt, parseCollectorReply } from '../../domain/collector'
import { AppError } from '../../domain/errors'
import { decide } from '../../domain/learning-schedule'
import { PORTION_CHARS, parseLearningSettings, patchLearningSettings } from '../../domain/learning-settings'
import { caseIdOf, chainOf, ingest } from './case-ingest'
import { JobQueue } from './job-queue'
import type { CaseState, JobState, LearningDeps, TranscriptCursor } from './learning.types'

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

	constructor(private readonly deps: LearningDeps) {
		this.settings = parseLearningSettings({ enabled: deps.defaultOn })
		this.queue = new JobQueue({ ids: deps.ids, now: () => deps.clock.now() })
	}

	load(): void {
		this.cases.clear()
		for (const c of this.deps.store.loadCases()) this.cases.set(c.id, c)
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
	}

	getSettings(): LearningSettings {
		return this.settings
	}

	view(): LearningView {
		const cases = [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toView)
		return { settings: this.settings, jobs: this.queue.list().map(j => this.queue.toView(j)), cases }
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
		this.getCase(id)
		this.assertIdle(id)
		this.cases.delete(id)
		this.queue.removeCase(id)
		this.deps.store.removeCase(id)
		this.deps.store.saveJobs(this.queue.list())
		this.deps.hub.publish({ t: 'learning_case_removed', id })
	}

	/** Пересборка описания: сбрасывает `coveredUntil` и `summary.md`, ставит итоговое задание `close`. */
	rebuild(id: string): JobView {
		const c = this.getCase(id)
		this.assertIdle(id)
		this.deps.store.writeSummary(id, '')
		this.update({ ...c, coveredUntil: 0, updatedAt: new Date(this.deps.clock.now()).toISOString() })
		return this.queue.toView(this.request('close', id, true))
	}

	/** Все незакрытые кейсы (сбор или ошибка) — на итоговый сбор. */
	runAll(): JobView[] {
		const open = [...this.cases.values()].filter(c => c.status === 'collecting' || c.status === 'error')
		return open.map(c => this.queue.toView(this.request('close', c.id, true)))
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
		const out: BackfillCandidate[] = []
		for (const s of sessions) {
			const chain = chainOf(sessions, s.id)
			const root = chain[0]
			if (root === undefined || roots.has(root)) continue
			roots.add(root)
			if (this.cases.has(caseIdOf(root))) continue
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
			const root = chainOf(this.deps.host.sessions(), id)[0] ?? id
			if (this.cases.has(caseIdOf(root)) || this.cases.has(transcriptCaseId(id))) skipped.push({ id, reason: 'кейс уже есть' })
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
		return { created, skipped }
	}

	private backfillSession(rootId: string): CaseState | null {
		const chain = chainOf(this.deps.host.sessions(), rootId)
		this.collect(rootId, chain, this.deps.host.messagesSince(0), 'backfill')
		return this.cases.get(caseIdOf(rootId)) ?? null
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
		}
		const r = store.copyTranscript(id, chatId, { path: file, offset: 0 })
		const { events, state } = ingest(base, { messages: [], transcripts: [{ chatId, text: r.text, next: r.next }] })
		if (events.length) store.appendRaw(id, events)
		this.update(state)
		return state
	}

	/** Сессию подключили к вкладке (в том числе после `/resume`): сразу подбираем её события. */
	onAttach(_sessionId: string): void {
		if (this.loaded) this.tick()
	}

	/** Синхронно: собирает события всех цепочек, затем принимает решения. */
	tick(): void {
		this.readSettings()
		// уже поставленные задания (повторы, ручные) идут и при выключенном обучении
		this.pump()
		if (!this.settings.enabled) return
		const { host, clock } = this.deps
		const sessions = host.sessions()
		const chains = new Map<string, string[]>()
		for (const s of sessions) {
			const chain = chainOf(sessions, s.id)
			const root = chain[0]
			if (root !== undefined && !chains.has(root)) chains.set(root, chain)
		}
		const active = [...chains.entries()].filter(([, chain]) => !chain.some(id => this.settings.disabledSessions.includes(id)))
		if (!active.length) return
		const from = Math.min(...active.map(([root]) => this.cases.get(caseIdOf(root))?.feedSeq ?? 0))
		const messages = host.messagesSince(from)
		for (const [root, chain] of active) this.collect(root, chain, messages)
		const now = clock.now()
		for (const [root, chain] of active) {
			const c = this.cases.get(caseIdOf(root))
			if (!c) continue
			const pending = c.events - c.coveredUntil
			const action = decide(
				// кейс в ошибке с новыми событиями ведёт себя как закрытый: сразу собираем
				{ status: c.status === 'error' ? 'ready' : c.status, pending, lastRunAt: c.lastRunAt, lastEventAt: c.lastEventAt, busy: host.isBusy(chain), hasJob: this.hasJob(c.id) },
				now,
				this.settings,
			)
			if (action === 'collect') {
				// закрытый (или упавший) кейс получил события: сессия вернулась
				if (c.status === 'ready' || c.status === 'error') this.update({ ...c, status: 'collecting', closedAt: null, updatedAt: new Date(now).toISOString() })
				this.request('collect', c.id, false)
			} else if (action === 'close') {
				this.request('close', c.id, true)
			}
		}
	}

	/** Новые события одной цепочки: лента (только сообщения сессий цепочки) и транскрипты. */
	private collect(root: string, chain: string[], messages: readonly Message[], source: CaseView['source'] = 'live'): void {
		const { host, store, clock } = this.deps
		const id = caseIdOf(root)
		const existing = this.cases.get(id)
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
			feedSeq: 0,
			transcripts: {},
			nextN: 1,
			lastEventAt: 0,
			// новый кейс первый раз собирается по интервалу или по 15 событиям, а не сразу
			lastRunAt: now,
			nessyCalls: false,
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
			if (!s?.transcriptPath) continue
			const key = s.chatId ?? sid
			const prev = base.transcripts[key]
			const cur: TranscriptCursor = prev && prev.path === s.transcriptPath ? prev : { path: s.transcriptPath, offset: 0 }
			const r = store.copyTranscript(id, key, cur)
			if (r.text || r.next.offset !== cur.offset || r.next.path !== prev?.path) transcripts.push({ chatId: key, text: r.text, next: r.next })
		}
		const { events, state } = ingest(base, { messages: mine, transcripts })
		if (!events.length && !existing) return
		const maxSeen = unseen.reduce((max, m) => Math.max(max, m.seq), state.feedSeq)
		const touched = chain.reduce((max, sid) => Math.max(max, Date.parse(byId.get(sid)?.updatedAt ?? '') || 0), state.lastEventAt)
		const next: CaseState = {
			...state,
			feedSeq: maxSeen,
			sessions: chain,
			lastEventAt: touched,
			updatedAt: events.length || chain.join() !== base.sessions.join() ? iso : base.updatedAt,
		}
		if (events.length) store.appendRaw(id, events)
		this.update(next)
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
		const job = this.queue.enqueue(kind, caseId, final)
		this.jobsChanged(job)
		this.pump()
		return job
	}

	private hasJob(caseId: string): boolean {
		return this.queue.hasJob(caseId)
	}

	/** Ручной «Собрать кейс сейчас»: задание `close` по кейсу или по сессии; работает и при выключенном обучении. */
	runNow(sessionOrCaseId: string): JobView {
		const c = this.findCase(sessionOrCaseId)
		if (!c) throw new AppError(404, 'no_case', `нет кейса или сессии ${sessionOrCaseId}`)
		return this.queue.toView(this.request('close', c.id, true))
	}

	/** Вкладку закрыли: сразу собираем итоговое описание. Выключено (в целом или для сессии) — молчим. */
	onSessionClosed(sessionId: string): void {
		this.readSettings()
		if (!this.settings.enabled) return
		// отключённой сессии (и всей её цепочки) кейс не заводим
		if (chainOf(this.deps.host.sessions(), sessionId).some(id => this.settings.disabledSessions.includes(id))) return
		const c = this.findCase(sessionId)
		if (!c || c.sessions.some(id => this.settings.disabledSessions.includes(id))) return
		this.request('close', c.id, true)
	}

	/** Ручной повтор упавшего задания. */
	retry(jobId: string): JobView {
		const job = this.queue.retry(jobId)
		const c = this.cases.get(job.caseId)
		if (c && job.kind === 'close' && c.status === 'error') this.update({ ...c, status: 'closing', updatedAt: new Date(this.deps.clock.now()).toISOString() })
		this.jobsChanged(job)
		this.pump()
		return this.queue.toView(job)
	}

	/** Сессию нельзя удалять, пока её кейс не `ready` (если обучение для неё включено). */
	isProtected(sessionId: string): boolean {
		if (!this.settings.enabled || this.settings.disabledSessions.includes(sessionId)) return false
		for (const c of this.cases.values()) if (c.sessions.includes(sessionId)) return c.status !== 'ready'
		return false
	}

	/** Кейс по id или по сессии; для живой сессии сначала подбирает свежие события (кейс может ещё не существовать). */
	private findCase(idOrSession: string): CaseState | null {
		const direct = this.cases.get(idOrSession)
		if (direct) return direct
		const sessions = this.deps.host.sessions()
		if (sessions.some(s => s.id === idOrSession)) {
			const chain = chainOf(sessions, idOrSession)
			const root = chain[0]
			if (root !== undefined) {
				const from = this.cases.get(caseIdOf(root))?.feedSeq ?? 0
				this.collect(root, chain, this.deps.host.messagesSince(from))
				const c = this.cases.get(caseIdOf(root))
				if (c) return c
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
				const job = this.queue.next(this.deps.clock.now())
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

	private async execute(job: JobState): Promise<void> {
		const { store, host, clock } = this.deps
		const c = this.cases.get(job.caseId)
		if (!c) {
			job.note = 'кейс удалён'
			this.queue.finish(job.id)
			this.jobsChanged(job)
			return
		}
		const events = store.readRaw(c.id, c.coveredUntil + 1)
		if (!events.length) {
			this.queue.finish(job.id)
			this.jobsChanged(job)
			if (job.final) this.seal(c.id)
			return
		}
		const portion = renderPortion(events, PORTION_CHARS)
		job.range = [portion.from, portion.until]
		this.jobsChanged(job)
		const prompt = buildCollectorPrompt(store.readPrompt('session-collector'), {
			caseId: c.id,
			summary: store.readSummary(c.id),
			notes: store.readNotes(c.id),
			portion,
			final: job.final,
		})
		const res = await host.runAgent({ name: `collector-${c.id}`, title: `Описание сессии: ${c.title ?? c.id}`, prompt })
		job.agentId = res.agentId
		if (!res.ok) return this.fail(job, res.error ?? 'агент завершился с ошибкой')
		const parsed = parseCollectorReply(res.text)
		if (!parsed) return this.fail(job, 'в ответе нет <summary>')
		store.writeSummary(c.id, parsed.summary)
		const latest = this.cases.get(c.id)
		this.queue.finish(job.id)
		if (!latest) {
			job.note = 'кейс удалён'
			this.jobsChanged(job)
			return
		}
		const now = clock.now()
		this.update({
			...latest,
			coveredUntil: portion.until,
			title: parsed.title ?? latest.title,
			goals: parsed.goals.length ? parsed.goals : latest.goals,
			lastRunAt: now,
			updatedAt: new Date(now).toISOString(),
		})
		this.jobsChanged(job)
		// порция не дошла до конца событий: следующее задание того же вида ставится сразу
		if (events.some(e => e.n > portion.until)) this.request(job.kind, c.id, job.final)
		else if (job.final) this.seal(c.id)
	}

	/** Провал: повтор или `error`; упавшее `close` переводит кейс в `error`. */
	private fail(job: JobState, error: string): void {
		const j = this.queue.fail(job.id, error)
		if (j.status === 'error') {
			const c = this.cases.get(j.caseId)
			// пауза до следующей автоматической попытки считается от провала
			if (c) this.update({ ...c, status: j.kind === 'close' ? 'error' : c.status, lastRunAt: this.deps.clock.now(), updatedAt: new Date(this.deps.clock.now()).toISOString() })
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
	}
}
