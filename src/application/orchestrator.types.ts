import type { Clock, IdGenerator, RolePackagePort, SpaceFactory, StorePort } from './ports'
import type { OrchSettings } from './settings.types'

export interface OrchestratorDeps {
	settings: OrchSettings
	store: StorePort
	spaceFactory: SpaceFactory
	/** по умолчанию — системные часы */
	clock?: Clock
	/** по умолчанию — короткие случайные id */
	ids?: IdGenerator
	/** суффикс id сессии; по умолчанию — 4 hex */
	sessionSuffix?: () => string
	/** пакеты ролей; по умолчанию недоступны (роль с packageDir отклоняется) */
	rolePackages?: RolePackagePort
}
