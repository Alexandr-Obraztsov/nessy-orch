/**
 * Orchestrator — фасад прикладного слоя: собирает реестр, ленту и сервисы,
 * реализует AgentHost и отдаёт интерфейсному слою (HTTP) готовые сценарии.
 */
import type {
	AgentEvent,
	AgentView,
	GraphView,
	Message,
	ModelRequest,
	RoleRequest,
	RoleView,
	RuntimeInfo,
	SendRequest,
	SendResponse,
	SpaceRequest,
	SpaceView,
	SpawnRequest,
	SpawnResponse,
	StatusResponse,
	StreamEvent,
	AttachRequest,
	SessionPatch,
	SessionRequest,
	SessionStatus,
	SessionView,
	WaitResponse,
	SourceView,
} from '../../shared/types'
import type { AgentIdentity, MessageDraft, RolePresetFile, RoleSeedResult, TurnOutcome } from '../domain/types'
import { checkSender } from './authorize-sender'
import type { Agent } from './agent/agent'
import type { AgentHost } from './agent/agent.types'
import { Hub } from './hub'
import { createLearning } from './learning/create-learning'
import type { LearningService } from './learning/learning.service'
import { assembleOrchestrator } from './orchestrator.assembly'
import type { OrchestratorDeps } from './orchestrator.types'
import { restoreAgents, snapshotState } from './orchestrator-state'
import { Registry } from './registry'
import type { AgentsService } from './services/agents.service'
import type { ServiceContext } from './services/context.types'
import type { MessagingService } from './services/messaging.service'
import type { RolesService } from './services/roles.service'
import type { RuntimesService } from './services/runtimes.service'
import type { SessionsService } from './services/sessions.service'
import type { SourcesService } from './services/sources.service'
import type { SpacesService } from './services/spaces.service'
import type { Feed } from './feed'
import type { SessionPool } from './session-pool'
import type { SpaceRuntime, StorePort } from './ports'
import { SessionPruner } from './session-pruner'
import { buildStatus } from './status'

const SNAPSHOT_MESSAGES = 300
const GC_INTERVAL_MS = 5 * 60_000

export class Orchestrator implements AgentHost {
	readonly hub = new Hub()
	readonly registry = new Registry()
	private readonly pool: SessionPool
	readonly store: StorePort
	readonly feed: Feed
	readonly startedAt: number
	/** фоновое обучение; null — хранилище не подключено (тесты, встраивание) */
	readonly learning: LearningService | null

	private readonly spacesSvc: SpacesService
	private readonly messaging: MessagingService
	private readonly agentsSvc: AgentsService
	private readonly rolesSvc: RolesService
	private readonly sessionsSvc: SessionsService
	private readonly sourcesSvc: SourcesService
	private readonly runtimesSvc: RuntimesService
	private readonly ctx: ServiceContext
	private readonly pruner: SessionPruner
	private shuttingDown = false
	private gcTimer: NodeJS.Timeout | null = null

	constructor(private readonly deps: OrchestratorDeps) {
		const built = assembleOrchestrator(deps, {
			hub: this.hub,
			registry: this.registry,
			callbacks: this,
			saveSoon: () => this.saveSoon(),
			isShuttingDown: () => this.shuttingDown,
		})
		this.store = built.store
		this.startedAt = built.startedAt
		this.feed = built.feed
		this.pool = built.pool
		this.ctx = built.ctx
		this.spacesSvc = built.spacesSvc
		this.messaging = built.messaging
		this.rolesSvc = built.rolesSvc
		this.sessionsSvc = built.sessionsSvc
		this.sourcesSvc = built.sourcesSvc
		this.runtimesSvc = built.runtimesSvc
		this.agentsSvc = built.agentsSvc
		this.learning = createLearning(deps, { ctx: this.ctx, hub: this.hub, registry: this.registry, feed: this.feed, sessions: this.sessionsSvc, ops: this })
		this.pruner = new SessionPruner(this.registry, this.ctx, this.sessionsSvc, this.agentsSvc, this)
	}

	// ---------- загрузка / сохранение ----------
	load(): void {
		const st = this.store.loadState()
		this.rolesSvc.load()
		this.sessionsSvc.load()
		this.feed.load(st.msgSeq)
		for (const s of st.spaces) this.registry.spaces.set(s.name, this.spacesSvc.make(s))
		restoreAgents(st.agents, this.registry, this.sessionsSvc, this.ctx.agentDeps)
		this.learning?.load()
	}

	/**
	 * Начать фоновую работу — только после того, как HTTP-сервер занял порт: сообщения, ждавшие в очереди
	 * до рестарта, доставляются (агент поднимет serve и сессию). Иначе при занятом порте процесс упал бы,
	 * оставив запущенный nessy serve.
	 */
	start(): void {
		this.learning?.start()
		for (const a of this.registry.agents.values()) a.resumeQueue()
		// пространства, где уже есть агенты, прогреваем сразу: serve и заготовки сессий будут готовы к первому spawn
		for (const name of new Set([...this.registry.agents.values()].map(a => a.space))) this.pool.warm(name)
		// завершённые агенты, которым давно не писали, убираются сами
		this.gcTimer = setInterval(() => void this.agentsSvc.collectGarbage().catch(() => undefined), GC_INTERVAL_MS)
		this.gcTimer.unref()
	}

	collectGarbage(now?: number): Promise<number> {
		return this.agentsSvc.collectGarbage(now)
	}

	/** Синхронно погасить все свои nessy serve (обработчик process 'exit'). */
	killChildrenSync(): void {
		for (const s of this.registry.spaces.values()) s.killSync()
	}

	saveSoon(): void {
		this.store.saveStateSoon(() => snapshotState(this.registry, this.feed.msgSeq))
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true
		if (this.gcTimer) clearInterval(this.gcTimer)
		await this.learning?.stop()
		await this.pool.closeAll()
		for (const a of this.registry.agents.values()) a.detach()
		this.feed.close()
		this.store.saveStateSoon(() => snapshotState(this.registry, this.feed.msgSeq))
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

	takeWarmSession(space: string, model: string | null): string | null {
		// заготовки созданы на модели пространства: агенту со своей (отличной) моделью заготовка не подходит
		if (model !== null && model !== this.registry.getSpace(space)?.model) return null
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

	spawn(req: SpawnRequest, onCreated?: (agentId: string) => void): Promise<SpawnResponse> {
		return this.agentsSvc.spawn(req, onCreated)
	}

	removeAgent(ref: string): Promise<void> {
		return this.agentsSvc.remove(ref)
	}

	cancelAgent(ref: string): Promise<AgentView> {
		return this.agentsSvc.cancel(ref)
	}

	/** Сменить модель живого агента (409 model_switch_unsupported, если рантайм не умеет; 409 busy у работающего). */
	setAgentModel(ref: string, req: ModelRequest): Promise<AgentView> {
		return this.agentsSvc.setModel(ref, req)
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

	// ---------- рантаймы ----------
	listRuntimes(): RuntimeInfo[] {
		return this.runtimesSvc.list()
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

	/** Создать роли папку для файлов (если её нет); `{{role_dir}}` в инструкциях начнёт подставляться. */
	ensureRolePackage(ref: string): RoleView {
		return this.rolesSvc.ensurePackage(ref)
	}

	/** Подхватить правки role.md из папки роли (редактор кода, Finder) в саму роль. */
	syncRoleFromDisk(ref: string): RoleView {
		return this.rolesSvc.syncFromDisk(ref)
	}

	removeRole(ref: string): void {
		this.rolesSvc.remove(ref)
	}

	// ---------- сессии ----------
	listSessions(status?: SessionStatus): SessionView[] {
		return this.sessionsSvc.list({ ...(status ? { status } : {}) })
	}

	getSession(id: string): SessionView {
		return this.sessionsSvc.resolve(id)
	}

	/** Источники, собранные за сессию (ссылки из ответов и вызовов инструментов агентов). */
	sessionSources(id: string): SourceView[] {
		return this.sourcesSvc.list(this.sessionsSvc.resolve(id).id)
	}

	createSession(req: SessionRequest): SessionView {
		const session = this.sessionsSvc.create(req)
		void this.pruneSessions(session.id).catch(() => undefined)
		return session
	}

	/**
	 * Не держим много сессий: сверх `maxSessions` удаляем самые давние, в которых никто не работает и ничего не происходило последние
	 * полчаса, вместе с их (простаивающими) агентами. Свежие и работающие не трогаем: лимит может быть временно превышен.
	 */
	async pruneSessions(keepId: string): Promise<number> {
		return this.pruner.prune(keepId)
	}

	/** Сессию разбирает фоновое обучение (незакрытый кейс): уборка её не трогает. */
	isSessionProtected(id: string): boolean {
		return this.learning?.isProtected(id) ?? false
	}

	/** Служебная сессия (фоновое обучение): создаётся при первом вызове, в списки и граф не входит. */
	ensureServiceSession(id: string, title: string, cwd: string): SessionView {
		return this.sessionsSvc.ensureService(id, title, cwd)
	}

	/** Чат Claude начался или сменился: сессия этого чата (создаётся, если её нет) и переход вкладки к ней. */
	attachSession(req: AttachRequest): SessionView {
		return this.sessionsSvc.attach(req)
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
		const id = session === undefined ? undefined : this.sessionsSvc.resolve(session).id
		return [...this.registry.agents.values()].map(a => a.toJSON()).filter(a => id === undefined || a.session === id)
	}

	authorizeSender(from: string | undefined, caller: { operator: boolean; agentKey: string | null }): void {
		checkSender(this.registry, from, caller)
	}

	// ---------- сообщения ----------
	post(draft: MessageDraft): Message {
		return this.messaging.post(draft)
	}

	send(ref: string, req: SendRequest): Promise<SendResponse> {
		return this.messaging.send(ref, req)
	}

	listMessages(opts: { agent?: string; since?: number; limit?: number } = {}): Message[] {
		return this.messaging.list(opts)
	}

	/**
	 * Дождаться, пока агент освободится (его ход и очередь закончились), и вернуть его последний ответ. Так `nessy-orch wait <агент>`
	 * (и `spawn` / `send`, которые ждут сами) возвращает результат одному вызову, которому он нужен; ящика входящих нет.
	 */
	waitAgent(ref: string, timeoutSec: number): Promise<WaitResponse> {
		return this.agentsSvc.waitIdle(ref, timeoutSec)
	}

	/** Вкладка закрыта: работающие агенты сессии останавливаются (без хозяина они жгли бы токены); сессия и ответы остаются. */
	async sessionClosed(id: string): Promise<{ cancelled: number }> {
		const session = this.sessionsSvc.resolve(id).id
		const busy = [...this.registry.agents.values()].filter(a => a.session === session && a.isBusy)
		for (const a of busy) await a.cancel()
		this.learning?.onSessionClosed(session)
		return { cancelled: busy.length }
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
		return buildStatus(
			{ version, startedAt: this.startedAt, home: this.deps.settings.home, autoApprove: this.deps.settings.autoApprove },
			this.hub,
			this.registry,
			this.rolesSvc.count,
		)
	}
}
