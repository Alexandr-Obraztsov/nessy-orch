/** Страница приложения: панель агентов или справочники (открываются из меню ⚙). */
export type Page = { kind: 'main' } | { kind: 'roles'; roleId: string | null } | { kind: 'spaces' }

export type DialogKind = 'space' | null

/** Фильтр по чипам сводки: все, ждут разрешения, работают, ошибки, выполнено. */
export type StatusFilter = 'all' | 'wait' | 'working' | 'error' | 'done'

/** Группа таблицы агентов. */
export type GroupKey = 'work' | 'done'

export interface ViewState {
	page: Page
	/** агент, чьи детали открыты справа (на телефоне — снизу) */
	selectedAgentId: string | null
	filter: StatusFilter
	/** скрыть группу «Выполнено» (запоминается) */
	hideDone: boolean
	/** свёрнутые группы таблицы (запоминается) */
	collapsed: GroupKey[]
	dialog: DialogKind
}
