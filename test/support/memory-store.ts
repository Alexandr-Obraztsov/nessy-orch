/** Хранилище в памяти и поддельный шлюз nessy для unit-тестов прикладного слоя. */
import type { AgentEvent, Message, RoleView, SpaceView } from '../../shared/types'
import type { PersistedState } from '../../src/application/persisted.types'
import type { NessyGateway, SessionSubscription, SpaceRuntime, StorePort, SubscribeOptions } from '../../src/application/ports'

export class MemoryStore implements StorePort {
	state: PersistedState = { spaces: [], agents: [], msgSeq: 0, inboxCursor: 0 }
	messages: Message[] = []
	events = new Map<string, AgentEvent[]>()
	roles: RoleView[] = []
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
	/** сколько раз создавали и поднимали (/load) сессии */
	creates = 0
	resumes = 0
	createSession(): Promise<{ sessionId: string }> {
		this.creates++
		return Promise.resolve({ sessionId: `s-${++this.n}` })
	}
	resumeSession(): Promise<boolean> {
		this.resumes++
		return Promise.resolve(true)
	}
	/** пока задан — ответ на prompt задерживается (промпт «летит» в nessy) */
	promptGate: Promise<void> | null = null
	async prompt(_sessionId: string, text: string): Promise<{ promptId: string | null }> {
		this.prompts.push(text)
		const id = `p-${this.prompts.length}`
		if (this.promptGate) await this.promptGate
		return { promptId: id }
	}
	cancel(): Promise<void> {
		this.cancels++
		return Promise.resolve()
	}
	closeSession(): Promise<void> {
		return Promise.resolve()
	}
	vote(_sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		this.votes.push({ requestId, optionId })
		return Promise.resolve()
	}
	subscribe(sessionId: string, opts: SubscribeOptions): SessionSubscription {
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
	readonly url = null
	readonly color = 210
	readonly managed: boolean = false
	status: SpaceView['status'] = 'ready'
	constructor(
		readonly name: string,
		readonly path: string,
		readonly client: FakeGateway,
	) {}
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
