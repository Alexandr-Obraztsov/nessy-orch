/** Общий контекст прикладных сервисов (собирается в Orchestrator). */
import type { AgentDeps } from '../agent/agent.types'
import type { Feed } from '../feed'
import type { Hub } from '../hub'
import type { Clock, IdGenerator, StorePort } from '../ports'
import type { Registry } from '../registry'
import type { OrchSettings } from '../settings.types'

export interface ServiceContext {
	registry: Registry
	feed: Feed
	hub: Hub
	store: StorePort
	settings: OrchSettings
	clock: Clock
	ids: IdGenerator
	/** зависимости для создания/восстановления агентов */
	agentDeps: AgentDeps
	saveSoon(): void
	isShuttingDown(): boolean
}
