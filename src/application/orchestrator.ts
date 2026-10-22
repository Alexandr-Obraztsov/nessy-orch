/**
 * Orchestrator — фасад прикладного слоя: собирает реестр, ленту и сервисы,
 * реализует AgentHost и отдаёт интерфейсному слою (HTTP) готовые сценарии.
 */
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import { SERVICE_SESSION, USER, YOU } from '../domain/constants'
import { AppError } from '../domain/errors'
import type {
	AgentEvent,
	AgentView,
	GraphView,
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
	AttachRequest,
	SessionPatch,
	SessionRequest,
	SessionStatus,
	SessionView,
	WaitResponse,
	SourceView,
} from '../../shared/types'
import type { AgentIdentity, MessageDraft, RolePresetFile, RoleSeedResult, TurnOutcome } from '../domain/types'
import { rid } from '../lib/ids'
import { Agent } from './agent/agent'
import type { AgentHost } from './agent/agent.types'
import { Feed } from './feed'
import { Hub } from './hub'
import { LearningService } from './learning/learning.service'
import type { LearningHost } from './learning/learning.types'
import type { OrchestratorDeps } from './orchestrator.types'
import type { PersistedState } from './persisted.types'
import type { RolePackagePort, SpaceRuntime, StorePort } from './ports'
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
/** сколько последних сообщений читаем с диска, когда окна памяти не хватает (как в Feed) */
const DISK_HISTORY_LIMIT = 100_000
/** жёсткий предел ожидания фонового агента (сек); зависшего снимает сторож заданий (`JOB_STALL_MS`) */
const LEARNING_AGENT_TIMEOUT_SEC = 4 * 3600
const DEFAULT_CANCEL_GRACE_MS = 3000
const DEFAULT_IDLE_CLOSE_MS = 120_000
const GC_INTERVAL_MS = 5 * 60_000

/** Сессия, в которой что-то происходило недавно, при уборке не удаляется */
const SESSION_FRESH_MS = 30 * 60_000

/** Пакеты ролей не подключены (тесты, встраивание): роль с packageDir отклоняется понятной ошибкой. */
const NO_ROLE_PACKAGES: RolePackagePort = {
	install: () => {
		throw new AppError(400, 'packages_unavailable', 'пакеты ролей недоступны в этой сборке')
	},
	dirOf: () => null,
	remove: () => undefined,
	ensure: () => {
		throw new AppError(400, 'packages_unavailable', 'пакеты ролей недоступны в этой сборке')
	},
	write: () => undefined,
	read: () => null,
}

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
	private readonly ctx: ServiceContext
	private shuttingDown = false
	private gcTimer: NodeJS.Timeout | null = null

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
			rolePackages: deps.rolePackages ?? NO_ROLE_PACKAGES,
			agentDeps: {
				host: this,
				hub: this.hub,
				store: deps.store,
				clock,
				autoApprove: deps.settings.autoApprove,
				cancelGraceMs: deps.settings.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS,
				idleCloseMs: deps.settings.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS,
				newKey: () => ids.next(24),
				showKey: deps.settings.authRequired === true,
				cliPath: deps.settings.cliPath,
				turnRetries: deps.settings.turnRetries ?? 0,
				...(deps.settings.turnRetryBaseMs !== undefined ? { turnRetryBaseMs: deps.settings.turnRetryBaseMs } : {}),
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
		const learningStore = deps.learningStore
		// Claude Code перечитывает плагин по версии: счётчик публикаций стартует с текущих секунд, чтобы версия росла и между запусками
		const pluginVersion = (): (() => string) => {
			let n = Math.floor(clock.now() / 1000)
			return () => `1.0.${n++}`
		}
		this.learning = learningStore
			? new LearningService({
					store: learningStore,
					...(deps.playbookStore ? { playbookStore: deps.playbookStore, pluginVersion: pluginVersion() } : {}),
					host: this.learningHost(),
					hub: this.hub,
					clock,
					ids,
					defaultOn: deps.settings.learningDefaultOn ?? true,
					tickMs: deps.settings.learningTickMs ?? 30_000,
					claudeProjectsDir: deps.settings.claudeProjectsDir ?? path.join(os.homedir(), '.claude', 'projects'),
				})
			: null
	}

	/** Что фоновому обучению нужно от оркестратора: сессии, лента, занятость и запуск агентов. */
	private learningHost(): LearningHost {
		return {
			sessions: () => this.sessionsSvc.list(),
			messagesSince: seq => {
				const mem = this.feed.recent(Number.MAX_SAFE_INTEGER)
				const first = mem[0]
				if (first && first.seq > seq + 1) return this.store.loadMessages(DISK_HISTORY_LIMIT).filter(m => m.seq > seq)
				return mem.filter(m => m.seq > seq)
			},
			lastSeq: () => this.feed.msgSeq,
			sessionOfMessage: m => m.session ?? this.registry.agents.get(m.to)?.session ?? this.registry.agents.get(m.from)?.session ?? null,
			isBusy: ids => [...this.registry.agents.values()].some(a => a.session !== null && ids.includes(a.session) && (a.isBusy || a.queue.length > 0)),
			// агент уже мог уйти (ответил и удалён): отмена ничего не ломает
			cancelAgent: async agentId => {
				await this.cancelAgent(agentId).catch(() => undefined)
			},
			runAgent: async ({ name, title, prompt, onSpawn }) => {
				let agentId = ''
				try {
					const casesDir = this.deps.learningStore?.casesDir ?? ''
					this.deps.learningStore?.ensureCasesDir()
					this.ensureServiceSession(SERVICE_SESSION, 'Фон', casesDir)
					const res = await this.spawn({ session: SERVICE_SESSION, name, title, prompt, wait: true, waitTimeoutSec: LEARNING_AGENT_TIMEOUT_SEC }, id => {
						agentId = id
						onSpawn?.(id)
					})
					agentId = res.agent.id
					const ok = !!res.reply && !res.reply.failed
					// фоновые агенты реестр не засоряют: ответ сервис сохранит сам, агента убираем
					await this.removeAgent(agentId).catch(() => undefined)
					return { agentId, text: res.reply?.text ?? '', ok, ...(ok ? {} : { error: res.reply?.text || 'агент не ответил' }) }
				} catch (e) {
					if (agentId) await this.removeAgent(agentId).catch(() => undefined)
					return { agentId, text: '', ok: false, error: e instanceof Error ? e.message : String(e) }
				}
			},
		}
	}

	get settings(): OrchestratorDeps['settings'] {
		return this.deps.settings
	}

	// ---------- загрузка / сохранение ----------
	load(): void {
		const st = this.store.loadState()
		this.rolesSvc.load()
		this.sessionsSvc.load()
		this.feed.load(st.msgSeq)
		for (const s of st.spaces) this.registry.spaces.set(s.name, this.spacesSvc.make(s))
		for (const p of st.agents) {
			// пространство пропало из состояния: агент остаётся (его чат и ответы не теряем), а статус — ошибка с причиной
			const lost = !this.registry.spaces.has(p.space)
			// старые состояния без сессии и ссылки на пропавшую сессию → вне сессий
			const session = p.session && this.sessionsSvc.has(p.session) ? p.session : null
			const agent = Agent.restore({ ...p, session }, this.ctx.agentDeps)
			if (lost) agent.markLost(`пространство «${p.space}» не найдено — агент недоступен, пока оно не добавлено снова`)
			this.registry.agents.set(p.id, agent)
		}
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

	private persistState(): PersistedState {
		return {
			spaces: [...this.registry.spaces.values()].map(s => ({ name: s.name, path: s.path, url: s.url, color: s.color })),
			agents: [...this.registry.agents.values()].map(a => a.persist()),
			msgSeq: this.feed.msgSeq,
		}
	}

	saveSoon(): void {
		this.store.saveStateSoon(() => this.persistState())
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true
		if (this.gcTimer) clearInterval(this.gcTimer)
		await this.learning?.stop()
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

	spawn(req: SpawnRequest, onCreated?: (agentId: string) => void): Promise<SpawnResponse> {
		return this.agentsSvc.spawn(req, onCreated)
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
		// одна уборка за раз: две параллельные видели бы одни и те же «лишние» сессии и удалили бы лишнее
		const run = (this.pruning ?? Promise.resolve(0)).then(() => this.pruneOnce(keepId))
		this.pruning = run.catch(() => 0)
		return run
	}

	private pruning: Promise<number> | null = null

	private async pruneOnce(keepId: string): Promise<number> {
		const max = this.ctx.settings.maxSessions ?? 10
		const now = this.ctx.clock.now()
		const agentsOf = (id: string): Agent[] => [...this.registry.agents.values()].filter(a => a.session === id)
		const lastActivity = (s: SessionView): number => Math.max(Date.parse(s.updatedAt), ...agentsOf(s.id).map(a => Date.parse(a.lastActivityAt)))
		const candidates = this.sessionsSvc
			.list()
			.filter(s => s.id !== keepId && !this.learning?.isProtected(s.id) && agentsOf(s.id).every(a => !a.isBusy && a.queue.length === 0) && now - lastActivity(s) > SESSION_FRESH_MS)
			.sort((a, b) => lastActivity(a) - lastActivity(b))
		let removed = 0
		for (const s of candidates) {
			if (this.sessionsSvc.list().length <= max) break // число пересчитывается по живым данным
			if (!this.sessionsSvc.has(s.id)) continue
			for (const a of agentsOf(s.id)) await this.agentsSvc.remove(a.id).catch(() => undefined)
			try {
				this.removeSession(s.id)
				removed++
			} catch {
				/* сессия снова занята — пропускаем */
			}
		}
		return removed
	}

	/** Служебная сессия (фоновое обучение): создаётся при первом вызове, в списки и граф не входит. */
	ensureServiceSession(id: string, title: string, cwd: string): SessionView {
		return this.sessionsSvc.ensureService(id, title, cwd)
	}

	/** Чат Claude начался или сменился: сессия этого чата (создаётся, если её нет) и переход вкладки к ней. */
	attachSession(req: AttachRequest): SessionView {
		const session = this.sessionsSvc.attach(req)
		this.learning?.onAttach(session.id)
		return session
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

	/**
	 * Проверка «от чьего имени» вызов: оператор (токен) может всё; без токена — только от имени агента с его ключом
	 * (`--from <агент> --key <ключ>`), иначе агент мог бы выдать себя за оператора или за другого агента. 403 operator_required / bad_agent_key.
	 */
	authorizeSender(from: string | undefined, caller: { operator: boolean; agentKey: string | null }): void {
		if (caller.operator) return
		if (!from || from === YOU || from === USER) throw new AppError(403, 'operator_required', 'от имени оператора можно только с токеном; агент пишет от своего имени: --from <свой id> --key <ключ из вводной>')
		const agent = this.registry.resolveAgent(from)
		const a = Buffer.from(agent.key)
		const b = Buffer.from(caller.agentKey ?? '')
		if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError(403, 'bad_agent_key', `ключ агента ${agent.id} не подошёл: возьми --key из своей вводной`)
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
		let cancelled = 0
		for (const a of this.registry.agents.values()) {
			if (a.session !== session || !a.isBusy) continue
			cancelled++
			await a.cancel()
		}
		this.learning?.onSessionClosed(session)
		return { cancelled }
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
