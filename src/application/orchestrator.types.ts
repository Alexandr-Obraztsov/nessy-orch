import type { Clock, IdGenerator, SpaceFactory, StorePort } from './ports'
import type { OrchSettings } from './settings.types'

export interface OrchestratorDeps {
	settings: OrchSettings
	store: StorePort
	spaceFactory: SpaceFactory
	/** по умолчанию — системные часы */
	clock?: Clock
	/** по умолчанию — короткие случайные id */
	ids?: IdGenerator
}
