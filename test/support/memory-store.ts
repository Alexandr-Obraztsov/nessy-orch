/** Хранилище в памяти и поддельный порт агента для unit-тестов прикладного слоя. */
import type { AgentEvent, Message, RoleView, SpaceView, SessionView, SourceView } from '../../shared/types'
import type { PersistedState } from '../../src/application/persisted.types'
import type { SpaceListener, SpaceRuntime, StorePort } from '../../src/application/ports'
import type { AgentPort } from '../../src/application/agent-port'
import { FakeAgentPort } from './fake-agent-port'

export { FakeAgentPort }

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

export class FakeSpace implements SpaceRuntime {
	killSync(): void {
		/* фейк без процесса */
	}

	readonly url = null
	readonly color = 210
	status: SpaceView['status'] = 'stopped'
	constructor(
		readonly name: string,
		readonly path: string,
		readonly client: FakeAgentPort,
		private readonly listener?: SpaceListener,
	) {}
	/** Имитация падения рантайма (не по просьбе оркестратора). */
	crash(): void {
		this.listener?.onExit(this, { intended: false, code: 1, signal: null })
	}
	ensureReady(): Promise<AgentPort> {
		if (this.status !== 'ready') {
			this.status = 'ready'
			this.listener?.onStatus(this)
		}
		return Promise.resolve(this.client)
	}
	stop(): Promise<void> {
		return Promise.resolve()
	}
	toJSON(): SpaceView {
		// у FakeSpace нет внешнего url — пространство всегда «managed»
		return { name: this.name, path: this.path, color: this.color, mode: 'managed', url: null, status: this.status, error: null }
	}
}
