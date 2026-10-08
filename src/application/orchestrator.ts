/**
 * Orchestrator — фасад прикладного слоя: собирает реестр, ленту и сервисы,
 * реализует AgentHost и отдаёт интерфейсному слою (HTTP) готовые сценарии.
 */
import type {
	AgentEvent,
	AgentView,
	GraphView,
	InboxResponse,
	Message,
	RoleRequest,
	RoleView,
	SendRequest,
	SendResponse,
	SpaceRequest,
	SpaceView,
	SpawnRequest,
	SpawnResponse,
	StatusResponse,
	StreamEvent,
} from '../../shared/types'
import type { AgentIdentity, MessageDraft, RolePresetFile, RoleSeedResult, TurnOutcome } from '../domain/types'
import { rid } from '../lib/ids'
import { Agent } from './agent/agent'
import type { AgentHost } from './agent/agent.types'
import { Feed } from './feed'
import type { InboxQuery } from './feed.types'
import { Hub } from './hub'
import type { OrchestratorDeps } from './orchestrator.types'
import type { PersistedState } from './persisted.types'
import type { NessyGateway, SpaceRuntime, StorePort } from './ports'
import { Registry } from './registry'
import { AgentsService } from './services/agents.service'
import type { ServiceContext } from './services/context.types'
import { MessagingService } from './services/messaging.service'
import { RolesService } from './services/roles.service'
import { ServeKeeper } from './services/serve-keeper'
import { SpacesService } from './services/spaces.service'

const SNAPSHOT_MESSAGES = 300
const DEFAULT_CANCEL_GRACE_MS = 3000

export class Orchestrator implements AgentHost {
	readonly hub = new Hub()
	readonly registry = new Registry()
	readonly store: StorePort
	readonly feed: Feed
	readonly startedAt: number

	private readonly spacesSvc: SpacesService
	private readonly messaging: MessagingService
	private readonly agentsSvc: AgentsService
	private readonly rolesSvc: RolesService
	private readonly keeper: ServeKeeper
	private readonly ctx: ServiceContext
	private shuttingDown = false
	private started = false

	constructor(private readonly deps: OrchestratorDeps) {
		const clock = deps.clock ?? { now: () => Date.now() }
		const ids = deps.ids ?? { next: (len: number) => rid(len) }
		this.store = deps.store
		this.startedAt = clock.now()
		this.feed = new Feed({ hub: this.hub, store: deps.store, clock, ids, onChange: () => this.saveSoon() })
		this.ctx = {
			registry: this.registry,
			feed: this.feed,
			hub: this.hub,
			store: deps.store,
			settings: deps.settings,
			clock,
			ids,
			agentDeps: {
				host: this,
				hub: this.hub,
				store: deps.store,
				clock,
				autoApprove: deps.settings.autoApprove,
				cancelGraceMs: deps.settings.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS,
			},
			saveSoon: () => this.saveSoon(),
			isShuttingDown: () => this.shuttingDown,
		}
		this.keeper = new ServeKeeper(this.ctx, deps.log ?? (line => console.warn(line)))
		this.spacesSvc = new SpacesService(this.ctx, deps.spaceFactory, this.keeper)
		this.messaging = new MessagingService(this.ctx)
		this.rolesSvc = new RolesService(this.ctx)
		this.agentsSvc = new AgentsService(this.ctx, this.spacesSvc, this.messaging, this.rolesSvc)
	}

	get settings(): OrchestratorDeps['settings'] {
		return this.deps.settings
	}

	// ---------- загрузка / сохранение ----------
	/** Восстановить состояние из хранилища. Без побочных эффектов: процессы serve не запускаются. */
	load(): void {
		const st = this.store.loadState()
		this.rolesSvc.load()
		this.feed.load(st.msgSeq, st.inboxCursor)
		for (const s of st.spaces) this.registry.spaces.set(s.name, this.spacesSvc.make(s))
		for (const p of st.agents) {
			if (!this.registry.spaces.has(p.space)) continue
			this.registry.agents.set(p.id, Agent.restore(p, this.ctx.agentDeps))
		}
	}

	/**
	 * Фоновая работа после того, как HTTP-сервер начал слушать: доставить сообщения, ждавшие в очереди
	 * до рестарта (агент поднимет serve и сессию). По одному агенту — чтобы не поднимать разом десятки сессий.
	 */
	async start(): Promise<void> {
		if (this.started) return
		this.started = true
		this.keeper.start()
		for (const a of [...this.registry.agents.values()]) {
			if (this.shuttingDown) return
			await a.resumeQueue().catch(() => undefined)
		}
	}

	private persistState(): PersistedState {
		return {
			spaces: [...this.registry.spaces.values()].map(s => ({ name: s.name, path: s.path, url: s.url, color: s.color })),
			agents: [...this.registry.agents.values()].map(a => a.persist()),
			msgSeq: this.feed.msgSeq,
			inboxCursor: this.feed.inboxCursor,
		}
	}

	saveSoon(): void {
		this.store.saveStateSoon(() => this.persistState())
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true
		this.keeper.stop()
		for (const a of this.registry.agents.values()) a.detach()
		this.feed.close()
		this.store.saveStateSoon(() => this.persistState())
		this.store.flush()
		await Promise.all([...this.registry.spaces.values()].map(s => s.stop().catch(() => undefined)))
		this.store.close()
	}

	// ---------- AgentHost ----------
	getSpace(name: string): SpaceRuntime | undefined {
		return this.registry.getSpace(name)
	}

	ensureSpaceReady(space: SpaceRuntime): Promise<NessyGateway> {
		return this.keeper.ensureReady(space)
	}

	noteActivity(space: string): void {
		this.keeper.note(space)
	}

	labelOf(id: string): string {
		return this.registry.labelOf(id)
	}

	preambleFor(agent: AgentIdentity): string {
		return this.agentsSvc.preambleFor(agent)
	}

	onTurnDone(agent: AgentIdentity, msg: Message, text: string, outcome: TurnOutcome): Message | null {
		return this.messaging.onTurnDone(agent, msg, text, outcome)
	}

	// ---------- пространства ----------
	addSpace(req: SpaceRequest): SpaceView {
		return this.spacesSvc.add(req)
	}

	removeSpace(name: string, force = false): Promise<void> {
		return this.spacesSvc.remove(name, force, id => this.agentsSvc.remove(id))
	}

	/** Остановить управляемые serve, простаивающие дольше ORCH_SERVE_IDLE_MIN (вызывается и по таймеру). */
	stopIdleServes(): Promise<string[]> {
		return this.keeper.sweep()
	}

	// ---------- агенты ----------
	resolveAgent(ref: string): Agent {
		return this.registry.resolveAgent(ref)
	}

	getAgent(ref: string): AgentView {
		return this.registry.resolveAgent(ref).toJSON()
	}

	spawn(req: SpawnRequest): Promise<SpawnResponse> {
		return this.agentsSvc.spawn(req)
	}

	removeAgent(ref: string): Promise<void> {
		return this.agentsSvc.remove(ref)
	}

	cancelAgent(ref: string): Promise<AgentView> {
		return this.agentsSvc.cancel(ref)
	}

	archiveAgent(ref: string): AgentView {
		return this.agentsSvc.archive(ref)
	}

	restoreAgent(ref: string): AgentView {
		return this.agentsSvc.restore(ref)
	}

	/** Заменить план агента (entries) или убрать его (null); проверки — в AgentsService.setPlan. */
	setPlan(ref: string, req: { from?: string; entries: unknown }): AgentView {
		return this.agentsSvc.setPlan(ref, req)
	}

	resolvePermission(ref: string, requestId: string, approve: boolean): Promise<boolean> {
		return this.agentsSvc.resolvePermission(ref, requestId, approve)
	}

	agentHistory(ref: string, limit = 400, includeLive = true): AgentEvent[] {
		return this.agentsSvc.history(ref, limit, includeLive)
	}

	// ---------- роли ----------
	listRoles(): RoleView[] {
		return this.rolesSvc.list()
	}

	getRole(ref: string): RoleView {
		return this.rolesSvc.resolve(ref)
	}

	createRole(req: RoleRequest): RoleView {
		return this.rolesSvc.create(req)
	}

	updateRole(ref: string, req: RoleRequest): RoleView {
		return this.rolesSvc.update(ref, req)
	}

	/** Нет ли ещё файла ролей (первый запуск). */
	get hasStoredRoles(): boolean {
		return this.store.hasRoles()
	}

	seedRoles(files: readonly RolePresetFile[]): RoleSeedResult {
		return this.rolesSvc.seed(files)
	}

	removeRole(ref: string): void {
		this.rolesSvc.remove(ref)
	}

	// ---------- сообщения ----------
	post(draft: MessageDraft): Message {
		return this.messaging.post(draft)
	}

	send(ref: string, req: SendRequest): Promise<SendResponse> {
		return this.messaging.send(ref, req)
	}

	listMessages(opts: { agent?: string; since?: number; limit?: number } = {}): Message[] {
		const involving = opts.agent ? this.registry.resolveAgent(opts.agent).id : undefined
		return this.feed.list({ involving, since: opts.since, limit: opts.limit })
	}

	inbox(opts: InboxQuery = {}): Promise<InboxResponse> {
		return this.feed.inbox(opts)
	}

	// ---------- чтение ----------
	graph(): GraphView {
		return {
			rev: this.hub.rev,
			spaces: [...this.registry.spaces.values()].map(s => this.spacesSvc.view(s)),
			agents: [...this.registry.agents.values()].map(a => a.toJSON()),
			roles: this.rolesSvc.list(),
		}
	}

	snapshot(): Extract<StreamEvent, { t: 'snapshot' }> {
		return { t: 'snapshot', ...this.graph(), messages: this.feed.recent(SNAPSHOT_MESSAGES) }
	}

	status(version: string): StatusResponse {
		const agents = [...this.registry.agents.values()]
		return {
			version,
			pid: process.pid,
			uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
			rev: this.hub.rev,
			home: this.deps.settings.home,
			autoApprove: this.deps.settings.autoApprove,
			spaces: this.registry.spaces.size,
			agents: agents.length,
			working: agents.filter(a => a.status === 'working').length,
			roles: this.rolesSvc.count,
			serveIdleMin: this.keeper.idleMin,
			maxServes: this.keeper.maxServes,
			runningServes: this.keeper.running().length,
		}
	}
}
