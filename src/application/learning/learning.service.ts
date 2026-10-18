import type { CaseView, JobKind, LearningSettings, LearningView, Message } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { decide } from '../../domain/learning-schedule'
import { parseLearningSettings } from '../../domain/learning-settings'
import { caseIdOf, chainOf, ingest } from './case-ingest'
import type { CaseState, LearningDeps, TranscriptCursor } from './learning.types'

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
	/** временно, до Task 7: запросы заданий вместо JobQueue */
	readonly requested: Array<{ kind: JobKind; caseId: string; final: boolean }> = []

	constructor(private readonly deps: LearningDeps) {
		this.settings = parseLearningSettings({ enabled: deps.defaultOn })
	}

	load(): void {
		this.cases.clear()
		for (const c of this.deps.store.loadCases()) this.cases.set(c.id, c)
		this.readSettings()
		this.loaded = true
	}

	getSettings(): LearningSettings {
		return this.settings
	}

	view(): LearningView {
		const cases = [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toView)
		return { settings: this.settings, jobs: [], cases }
	}

	getCase(id: string): CaseState {
		const c = this.cases.get(id)
		if (!c) throw new AppError(404, 'not_found', `кейс ${id} не найден`)
		return c
	}

	/** Сессию подключили к вкладке (в том числе после `/resume`): сразу подбираем её события. */
	onAttach(_sessionId: string): void {
		if (this.loaded) this.tick()
	}

	/** Синхронно: собирает события всех цепочек, затем принимает решения. */
	tick(): void {
		this.readSettings()
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
				{ status: c.status, pending, lastRunAt: c.lastRunAt, lastEventAt: c.lastEventAt, busy: host.isBusy(chain), hasJob: this.hasJob(c.id) },
				now,
				this.settings,
			)
			if (action === 'collect') {
				// закрытый кейс получил события: сессия вернулась
				if (c.status === 'ready') this.update({ ...c, status: 'collecting', closedAt: null, updatedAt: new Date(now).toISOString() })
				this.request('collect', c.id, false)
			} else if (action === 'close') {
				this.request('close', c.id, true)
			}
		}
	}

	/** Новые события одной цепочки: лента (только сообщения сессий цепочки) и транскрипты. */
	private collect(root: string, chain: string[], messages: readonly Message[]): void {
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
			source: 'live',
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

	/** временно, до Task 7: заменить постановкой в JobQueue */
	private request(kind: JobKind, caseId: string, final: boolean): void {
		this.requested.push({ kind, caseId, final })
	}

	/** временно, до Task 7: есть ли по кейсу запрос/задание */
	private hasJob(caseId: string): boolean {
		return this.requested.some(r => r.caseId === caseId)
	}
}
