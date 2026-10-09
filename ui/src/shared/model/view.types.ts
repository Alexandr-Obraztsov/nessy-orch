/** Страница приложения: панель задач или справочники (ссылки внизу сайдбара). */
export type Page = { kind: 'main' } | { kind: 'roles'; roleId: string | null } | { kind: 'spaces' }

export type DialogKind = 'space' | null

/**
 * Колонка основной области: id задачи либо псевдо-задача — ALL_AGENTS («Все агенты»)
 * или NO_TASK («Без задачи», агенты с task=null).
 */
export type ColumnId = string

export interface ViewState {
	page: Page
	/** открытые рядом колонки (1–3), в порядке слева направо */
	columns: ColumnId[]
	/** агент, чьё окно открыто */
	agentId: string | null
	/** сайдбар развёрнут (десктоп, запоминается) */
	sidebar: boolean
	/** сайдбар выехал поверх (узкий экран) */
	drawer: boolean
	dialog: DialogKind
}
