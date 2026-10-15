/** Хранилище в памяти и поддельный шлюз nessy для unit-тестов прикладного слоя. */
import type { AgentEvent, Message, RoleView, SpaceView, SessionView, SourceView, TokenUsage } from '../../shared/types'
import type { PersistedState } from '../../src/application/persisted.types'
import { NessyBusyError } from '../../src/domain/errors'
import type { NessyGateway, SessionSubscription, SpaceListener, SpaceRuntime, StorePort, SubscribeOptions } from '../../src/application/ports'

export class MemoryStore implements StorePort {
	state: PersistedState = { spaces: [], agents: [], msgSeq: 0 }
	messages: Message[] = []
	events = new Map<string, AgentEvent[]>()
	roles: RoleView[] = []
	sessions: SessionView[] = []
	sources = new Map<string, SourceView[]>()
	private pending: (() => PersistedState) | null = null

	loadState(): PersistedState {
		return this.state
	}
	saveStateSoon(getState: () => PersistedState): void {
		this.pending = getState
	}
	flush(): void {
		if (this.pending) this.state = this.pending()
	}
	close(): void {
		this.flush()
	}
	hasRoles(): boolean {
		return this.roles.length > 0
	}
	loadRoles(): RoleView[] {
		return structuredClone(this.roles)
	}
	saveRoles(roles: readonly RoleView[]): void {
		this.roles = structuredClone([...roles])
	}
	loadSessions(): SessionView[] {
		return structuredClone(this.sessions)
	}
	saveSessions(sessions: readonly SessionView[]): void {
		this.sessions = structuredClone([...sessions])
	}
	appendSource(sessionId: string, source: SourceView): void {
		const list = this.sources.get(sessionId) ?? []
		list.push(structuredClone(source))
		this.sources.set(sessionId, list)
	}
	removeSources(sessionId: string): void {
		this.sources.delete(sessionId)
	}
	loadSources(sessionId: string): SourceView[] {
		return structuredClone(this.sources.get(sessionId) ?? [])
	}
	appendMessage(m: Message): void {
		this.messages.push(m)
	}
	loadMessages(limit: number): Message[] {
		return this.messages.slice(-limit)
	}
	appendEvent(agentId: string, ev: AgentEvent): void {
		const list = this.events.get(agentId) ?? []
		list.push(structuredClone(ev))
		this.events.set(agentId, list)
	}
	readEvents(agentId: string, limit: number): AgentEvent[] {
		return (this.events.get(agentId) ?? []).slice(-limit)
	}
	archiveAgent(agentId: string): void {
		this.events.delete(agentId)
	}
}

/** Шлюз, у которого тест сам «присылает» события через emit(). */
export class FakeGateway implements NessyGateway {
	prompts: string[] = []
	votes: Array<{ requestId: string; optionId: string | null }> = []
	cancels = 0
	/** подписки по сессиям (агентов может быть несколько) */
	private readonly subs = new Map<string, SubscribeOptions>()
	private n = 0

	health(): Promise<boolean> {
		return Promise.resolve(true)
	}
	/** сколько сессий создано (в том числе заготовок пула) и задержка создания, мс */
	created = 0
	sessionDelayMs = 0
	/** сколько ближайших созданий сессии отклонить лимитом сессий демона (503 session_limit_exceeded) */
	busySessions = 0
	/** сколько ближайших созданий сессии завершить обычной ошибкой (нет сети, nessy недоступен) */
	failCreate = 0
	async createSession(): Promise<{ sessionId: string }> {
		if (this.failCreate > 0) {
			this.failCreate--
			throw new Error('nessy недоступен')
		}
		if (this.busySessions > 0) {
			this.busySessions--
			throw new NessyBusyError('unavailable', 'nessy POST /session → 503: session_limit_exceeded', 5)
		}
		this.created++
		const id = `s-${++this.n}`
		if (this.sessionDelayMs > 0) await new Promise(r => setTimeout(r, this.sessionDelayMs))
		return { sessionId: id }
	}
	closed: string[] = []
	restored: string[] = []
	/** false — сессия «потеряна» (restoreSession → null) */
	canRestore = true
	restoreSession(sessionId: string): Promise<{ lastEventId: number | null } | null> {
		this.restored.push(sessionId)
		return Promise.resolve(this.canRestore ? { lastEventId: 7 } : null)
	}
	midTurns: string[] = []
	/** принимает ли nessy сообщение в идущий ход */
	acceptMidTurn = false
	midTurn(_sessionId: string, message: string): Promise<boolean> {
		if (this.acceptMidTurn) this.midTurns.push(message)
		return Promise.resolve(this.acceptMidTurn)
	}
	/** пока задан — ответ на prompt задерживается (промпт «летит» в nessy) */
	promptGate: Promise<void> | null = null
	/** сколько ближайших промптов отклонить временной ошибкой nessy (prompt_queue_full) */
	busyPrompts = 0
	async prompt(_sessionId: string, text: string): Promise<{ promptId: string | null }> {
		this.prompts.push(text)
		if (this.busyPrompts > 0) {
			this.busyPrompts--
			throw new NessyBusyError('queue_full', 'nessy POST /prompt → 503: prompt_queue_full', 5)
		}
		const id = `p-${this.prompts.length}`
		if (this.promptGate) await this.promptGate
		return { promptId: id }
	}
	/** токены, которые вернёт GET /stats (null — nessy не сообщает) */
	usageValue: TokenUsage | null = null
	contextUsage(): Promise<{ used: number; size: number | null } | null> {
		return Promise.resolve(null)
	}
	usage(): Promise<TokenUsage | null> {
		return Promise.resolve(this.usageValue)
	}
	cancel(): Promise<void> {
		this.cancels++
		return Promise.resolve()
	}
	closeSession(sessionId: string): Promise<void> {
		this.closed.push(sessionId)
		return Promise.resolve()
	}
	vote(_sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		this.votes.push({ requestId, optionId })
		return Promise.resolve()
	}
	/** с какого события подписывались (по порядку подписок) */
	subscribedFrom: Array<{ sessionId: string; lastEventId: number | null }> = []
	subscribe(sessionId: string, opts: SubscribeOptions): SessionSubscription {
		this.subscribedFrom.push({ sessionId, lastEventId: opts.lastEventId })
		this.subs.set(sessionId, opts)
		return {
			close: () => {
				if (this.subs.get(sessionId) === opts) this.subs.delete(sessionId)
			},
		}
	}
	/** Событие во все подписанные сессии (агенты вне хода игнорируют чужие события). */
	emit(...events: Parameters<SubscribeOptions['onEvent']>[0][]): void {
		for (const e of events) for (const o of [...this.subs.values()]) o.onEvent(e, null)
	}
}

export class FakeSpace implements SpaceRuntime {
	killSync(): void {
		/* фейк без процесса */
	}

	readonly url = null
	readonly color = 210
	status: SpaceView['status'] = 'ready'
	constructor(
		readonly name: string,
		readonly path: string,
		readonly client: FakeGateway,
		private readonly listener?: SpaceListener,
	) {}
	/** Имитация падения nessy serve (не по просьбе оркестратора). */
	crash(): void {
		this.listener?.onExit(this, { intended: false, code: 1, signal: null })
	}
	ensureReady(): Promise<NessyGateway> {
		return Promise.resolve(this.client)
	}
	stop(): Promise<void> {
		return Promise.resolve()
	}
	toJSON(): SpaceView {
		return { name: this.name, path: this.path, color: this.color, mode: 'external', url: null, status: this.status, error: null }
	}
}
