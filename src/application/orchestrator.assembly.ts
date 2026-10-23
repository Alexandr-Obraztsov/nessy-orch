/**
 * Сборка оркестратора: депсы + узкие колбэки хоста → лента, пул, контекст сервисов и сами сервисы.
 * Выделено из orchestrator.ts по единой ответственности — «сборка» (feed/пул/контекст/сервисы); оркестратор
 * остаётся фасадом с готовыми сценариями.
 */
import { AppError } from '../domain/errors'
import { rid } from '../lib/ids'
import type { AgentCallbacks } from './agent/agent.types'
import { Feed } from './feed'
import type { Hub } from './hub'
import type { OrchestratorDeps } from './orchestrator.types'
import type { RolePackagePort, StorePort } from './ports'
import type { Registry } from './registry'
import { SessionPool } from './session-pool'
import { AgentsService } from './services/agents.service'
import type { ServiceContext } from './services/context.types'
import { MessagingService } from './services/messaging.service'
import { RolesService } from './services/roles.service'
import { SpacesService } from './services/spaces.service'
import { SessionsService } from './services/sessions.service'
import { SourcesService } from './services/sources.service'

const DEFAULT_CANCEL_GRACE_MS = 3000
const DEFAULT_IDLE_CLOSE_MS = 120_000

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

/** Что оркестратор даёт сборке: свои узлы и колбэки (без круга сборка → оркестратор → сборка). */
export interface OrchestratorHost {
	hub: Hub
	registry: Registry
	callbacks: AgentCallbacks
	saveSoon: () => void
	isShuttingDown: () => boolean
}

/** Внутренности, которые конструктор оркестратора раскладывает по своим полям. */
export interface OrchestratorAssembly {
	store: StorePort
	startedAt: number
	feed: Feed
	pool: SessionPool
	ctx: ServiceContext
	spacesSvc: SpacesService
	messaging: MessagingService
	agentsSvc: AgentsService
	rolesSvc: RolesService
	sessionsSvc: SessionsService
	sourcesSvc: SourcesService
}

export function assembleOrchestrator(deps: OrchestratorDeps, host: OrchestratorHost): OrchestratorAssembly {
	const clock = deps.clock ?? { now: () => Date.now() }
	const ids = deps.ids ?? { next: (len: number) => rid(len) }
	const store = deps.store
	const startedAt = clock.now()
	const feed = new Feed({ hub: host.hub, store, clock, ids, onChange: () => host.saveSoon() })
	const pool = new SessionPool({
		target: () => deps.settings.warmSessions ?? 0,
		getSpace: name => host.registry.getSpace(name),
		now: () => clock.now(),
		isShuttingDown: () => host.isShuttingDown(),
	})
	const ctx: ServiceContext = {
		registry: host.registry,
		pool,
		feed,
		hub: host.hub,
		store,
		settings: deps.settings,
		clock,
		ids,
		rolePackages: deps.rolePackages ?? NO_ROLE_PACKAGES,
		agentDeps: {
			callbacks: host.callbacks,
			hub: host.hub,
			store,
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
		saveSoon: () => host.saveSoon(),
		isShuttingDown: () => host.isShuttingDown(),
	}
	const spacesSvc = new SpacesService(ctx, deps.spaceFactory)
	const messaging = new MessagingService(ctx)
	const rolesSvc = new RolesService(ctx)
	const sessionsSvc = new SessionsService(ctx, deps.sessionSuffix)
	const sourcesSvc = new SourcesService(ctx, sessionsSvc)
	const agentsSvc = new AgentsService(ctx, spacesSvc, messaging, rolesSvc, sessionsSvc)
	return { store, startedAt, feed, pool, ctx, spacesSvc, messaging, agentsSvc, rolesSvc, sessionsSvc, sourcesSvc }
}
