/**
 * Orchestrator — фасад прикладного слоя: собирает реестр, ленту и сервисы,
 * реализует AgentHost и отдаёт интерфейсному слою (HTTP) готовые сценарии.
 */
import type {
	AgentBrief,
	AgentEvent,
	ClaudeState,
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
	SpawnBatchRequest,
	SpawnBatchResponse,
	SpawnRequest,
	SpawnResponse,
	StatusResponse,
	StreamEvent,
	SessionPatch,
	SessionRequest,
	SessionUpdates,
	SessionStatus,
	SessionView,
	SourceView,
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
import type { SpaceRuntime, StorePort } from './ports'
import { Registry } from './registry'
import { SessionPool } from './session-pool'
import { AgentsService } from './services/agents.service'
import type { ServiceContext } from './services/context.types'
import { MessagingService } from './services/messaging.service'
import { RolesService } from './services/roles.service'
import { SpacesService } from './services/spaces.service'
import { SessionsService } from './services/sessions.service'
import { SourcesService } from './services/sources.service'

const SNAPSHOT_MESSAGES = 300
const DEFAULT_CANCEL_GRACE_MS = 3000

export class Orchestrator implements AgentHost {
	readonly hub = new Hub()
	readonly registry = new Registry()
	private readonly pool: SessionPool
	readonly store: StorePort
	readonly feed: Feed
	readonly startedAt: number

	private readonly spacesSvc: SpacesService
	private readonly messaging: MessagingService
	private readonly agentsSvc: AgentsService
	private readonly rolesSvc: RolesService
	private readonly sessionsSvc: SessionsService
	private readonly sourcesSvc: SourcesService
	private readonly ctx: ServiceContext
	private shuttingDown = false

	constructor(private readonly deps: OrchestratorDeps) {
		const clock = deps.clock ?? { now: () => Date.now() }
		const ids = deps.ids ?? { next: (len: number) => rid(len) }
		this.store = deps.store
		this.startedAt = clock.now()
		this.feed = new Feed({
			hub: this.hub,
			store: deps.store,
			clock,
			ids,
			onChange: () => this.saveSoon(),
			sessionOf: id => this.registry.agents.get(id)?.session ?? null,
		})
		this.pool = new SessionPool({
			target: () => deps.settings.warmSessions ?? 0,
			getSpace: name => this.registry.getSpace(name),
			now: () => clock.now(),
			isShuttingDown: () => this.shuttingDown,
		})
		this.ctx = {
			registry: this.registry,
			pool: this.pool,
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
				cliPath: deps.settings.cliPath,
			},
			saveSoon: () => this.saveSoon(),
			isShuttingDown: () => this.shuttingDown,
		}
		this.spacesSvc = new SpacesService(this.ctx, deps.spaceFactory)
		this.messaging = new MessagingService(this.ctx)
		this.rolesSvc = new RolesService(this.ctx)
		this.sessionsSvc = new SessionsService(this.ctx, deps.sessionSuffix)
		this.sourcesSvc = new SourcesService(this.ctx, this.sessionsSvc)
		this.agentsSvc = new AgentsService(this.ctx, this.spacesSvc, this.messaging, this.rolesSvc, this.sessionsSvc)
	}

	get settings(): OrchestratorDeps['settings'] {
		return this.deps.settings
	}

	// ---------- загрузка / сохранение ----------
	load(): void {
		const st = this.store.loadState()
		this.rolesSvc.load()
		this.sessionsSvc.load()
		// курсоры удалённых (пропавших из sessions.json) сессий не восстанавливаем
		const cursors = Object.fromEntries(Object.entries(st.sessionCursors ?? {}).filter(([t]) => this.sessionsSvc.has(t)))
		this.feed.load(st.msgSeq, st.inboxCursor, cursors)
		for (const s of st.spaces) this.registry.spaces.set(s.name, this.spacesSvc.make(s))
		for (const p of st.agents) {
			if (!this.registry.spaces.has(p.space)) continue
			// старые состояния без сессии и ссылки на пропавшую сессию → вне сессий
			const session = p.session && this.sessionsSvc.has(p.session) ? p.session : null
			this.registry.agents.set(p.id, Agent.restore({ ...p, session }, this.ctx.agentDeps))
		}
	}

	/**
	 * Начать фоновую работу — только после того, как HTTP-сервер занял порт: сообщения, ждавшие в очереди
	 * до рестарта, доставляются (агент поднимет serve и сессию). Иначе при занятом порте процесс упал бы,
	 * оставив запущенный nessy serve.
	 */
	start(): void {
		for (const a of this.registry.agents.values()) a.resumeQueue()
		// пространства, где уже есть агенты, прогреваем сразу: serve и заготовки сессий будут готовы к первому spawn
		for (const name of new Set([...this.registry.agents.values()].map(a => a.space))) this.pool.warm(name)
	}

	/** Синхронно погасить все свои nessy serve (обработчик process 'exit'). */
	killChildrenSync(): void {
		for (const s of this.registry.spaces.values()) s.killSync()
	}

	private persistState(): PersistedState {
		return {
			spaces: [...this.registry.spaces.values()].map(s => ({ name: s.name, path: s.path, url: s.url, color: s.color })),
			agents: [...this.registry.agents.values()].map(a => a.persist()),
			msgSeq: this.feed.msgSeq,
			inboxCursor: this.feed.inboxCursor,
			sessionCursors: this.feed.sessionCursorsSnapshot(),
		}
	}

	saveSoon(): void {
		this.store.saveStateSoon(() => this.persistState())
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true
		await this.pool.closeAll()
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

	labelOf(id: string): string {
		return this.registry.labelOf(id)
	}

	preambleFor(agent: AgentIdentity): string {
		return this.agentsSvc.preambleFor(agent)
	}

	onTurnDone(agent: AgentIdentity, msg: Message, text: string, outcome: TurnOutcome): Message | null {
		if (!outcome.error) this.sourcesSvc.addFromReply(agent.id, text)
		return this.messaging.onTurnDone(agent, msg, text, outcome)
	}

	takeWarmSession(space: string): string | null {
		return this.pool.take(space)
	}

	onToolUrls(agent: AgentIdentity, urls: readonly string[]): void {
		this.sourcesSvc.addFromTool(agent.id, urls)
	}

	// ---------- пространства ----------
	addSpace(req: SpaceRequest): SpaceView {
		return this.spacesSvc.add(req)
	}

	removeSpace(name: string, force = false): Promise<void> {
		return this.spacesSvc.remove(name, force, id => this.agentsSvc.remove(id))
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

	spawnMany(req: SpawnBatchRequest): Promise<SpawnBatchResponse> {
		return this.agentsSvc.spawnMany(req)
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

	// ---------- сессии ----------
	listSessions(status?: SessionStatus): SessionView[] {
		return this.sessionsSvc.list(status)
	}

	getSession(id: string): SessionView {
		return this.sessionsSvc.resolve(id)
	}

	/** Источники, собранные за сессию (ссылки из ответов и вызовов инструментов агентов). */
	sessionSources(id: string): SourceView[] {
		return this.sourcesSvc.list(this.sessionsSvc.resolve(id).id)
	}

	createSession(req: SessionRequest): SessionView {
		return this.sessionsSvc.create(req)
	}

	updateSession(id: string, patch: SessionPatch): SessionView {
		return this.sessionsSvc.update(id, patch)
	}

	/** Удалить сессию (агенты остаются вне сессий); 409 session_busy, если в ней работают агенты. */
	removeSession(id: string): void {
		const resolved = this.sessionsSvc.resolve(id).id
		this.sessionsSvc.remove(id)
		this.sourcesSvc.forget(resolved)
	}

	/** Агенты: все или только сессии `session` (неизвестная сессия → 404 no_session). */
	listAgents(session?: string): AgentView[] {
		const all = [...this.registry.agents.values()].map(a => a.toJSON())
		if (session === undefined) return all
		const id = this.sessionsSvc.resolve(session).id
		return all.filter(a => a.session === id)
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

	/** Входящие для you; с session — только ответы агентов сессии, со своим курсором (неизвестная → 404 no_session). */
	/** Состояние Claude Code сессии по хуку (`POST /sessions/:id/ping`). */
	bindSession(claudeId: string, ref: string | null, title: string): SessionView {
		return this.sessionsSvc.bind(claudeId, ref, title)
	}

	pingSession(id: string, state: ClaudeState): SessionView {
		return this.sessionsSvc.ping(id, state)
	}

	/**
	 * Что нового для Claude (хуки): краткая сводка агентов сессии и новые ответы. consume=true сдвигает тот же курсор, что и
	 * `inbox --session` — ответ доставляется Claude один раз, либо хуком, либо inbox.
	 */
	async sessionUpdates(id: string, consume: boolean): Promise<SessionUpdates> {
		const session = this.sessionsSvc.resolve(id).id
		const agents: AgentBrief[] = [...this.registry.agents.values()]
			.filter(a => a.session === session)
			.map(a => {
				const v = a.toJSON()
				const entries = v.plan?.entries ?? []
				return {
					id: v.id,
					name: v.name,
					role: v.role,
					status: v.status,
					archived: v.archived,
					lastTool: v.lastTool ? (v.lastTool.title || v.lastTool.name).slice(0, 80) : null,
					plan: entries.length ? { done: entries.filter(e => e.status === 'completed').length, total: entries.length } : null,
				}
			})
		const { messages } = await this.feed.inbox({ session, peek: !consume })
		return { agents, replies: messages }
	}

	async inbox(opts: InboxQuery = {}): Promise<InboxResponse> {
		if (opts.session !== undefined) return this.feed.inbox({ ...opts, session: this.sessionsSvc.resolve(opts.session).id })
		return this.feed.inbox(opts)
	}

	// ---------- чтение ----------
	graph(): GraphView {
		return {
			rev: this.hub.rev,
			spaces: [...this.registry.spaces.values()].map(s => s.toJSON()),
			agents: [...this.registry.agents.values()].map(a => a.toJSON()),
			roles: this.rolesSvc.list(),
			sessions: this.sessionsSvc.list(),
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
		}
	}
}
