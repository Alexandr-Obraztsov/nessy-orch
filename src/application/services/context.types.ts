/** Общий контекст прикладных сервисов (собирается в Orchestrator). */
import type { AgentDeps } from '../agent/agent.types'
import type { Feed } from '../feed'
import type { Hub } from '../hub'
import type { Clock, IdGenerator, RolePackagePort, StorePort } from '../ports'
import type { Registry } from '../registry'
import type { SessionPool } from '../session-pool'
import type { OrchSettings } from '../settings.types'

export interface ServiceContext {
	registry: Registry
	/** заранее созданные сессии nessy */
	pool: SessionPool
	feed: Feed
	hub: Hub
	store: StorePort
	settings: OrchSettings
	clock: Clock
	ids: IdGenerator
	rolePackages: RolePackagePort
	/** зависимости для создания/восстановления агентов */
	agentDeps: AgentDeps
	saveSoon(): void
	isShuttingDown(): boolean
}
