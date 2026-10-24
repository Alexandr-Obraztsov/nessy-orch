import type { Clock, IdGenerator, LearningStorePort, PlaybookStorePort, RolePackagePort, RuntimeCatalogSource, SpaceFactory, StorePort } from './ports'
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
	/** описания рантаймов для `GET /runtimes`; по умолчанию — встроенные без дефолтных моделей */
	runtimes?: RuntimeCatalogSource
	/** хранилище фонового обучения; без него обучение выключено (learning = null) */
	learningStore?: LearningStorePort
	/** хранилище плейбуков; без него обучение работает как на этапе 1 (кейсы без плейбуков) */
	playbookStore?: PlaybookStorePort
}
