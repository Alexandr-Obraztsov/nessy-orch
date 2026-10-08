/** Страница приложения: рабочий экран или справочники (открываются из меню ⚙). */
export type Page = { kind: 'main' } | { kind: 'roles'; roleId: string | null } | { kind: 'spaces' }

export type DialogKind = 'spawn' | 'space' | null

/** Фильтр по сводке (клик по счётчику в верхней строке). */
export type StatusFilter = 'all' | 'attention' | 'error' | 'working' | 'done'

/** Группировка списка поручений. */
export type Grouping = 'tasks' | 'spaces' | 'roles' | 'flat'

/** Вкладки нижней панели на узких экранах. */
export type MobileTab = 'attention' | 'tasks' | 'journal'

export interface ViewState {
	page: Page
	/** агент, чьи детали открыты справа (на узких — на весь экран) */
	selectedAgentId: string | null
	filter: StatusFilter
	grouping: Grouping
	search: string
	/** раскрыт ли журнал внизу */
	journalOpen: boolean
	mobileTab: MobileTab
	dialog: DialogKind
	/** предвыбор для диалога «+ Поручение» */
	spawnPreset: { space?: string; role?: string } | null
	/** свёрнутые карточки поручений (id корневого агента) */
	collapsed: string[]
}
