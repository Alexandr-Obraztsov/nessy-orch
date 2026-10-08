import type { AgentView } from '@contract'

export type AttentionKind = 'permission' | 'error' | 'result'

/** Элемент «Внимания»: то, что ждёт вашего решения или взгляда. */
export interface AttentionItem {
	/** стабильный ключ: perm:<agent>:<request> / err:<agent>:<время> / res:<msgId> */
	key: string
	kind: AttentionKind
	agent: AgentView
	/** разрешение: id запроса */
	requestId?: string
	/** разрешение — что просит; ошибка — текст; результат — превью ответа */
	text: string
	/** мс: когда возникло */
	ts: number
	/** результат: id ответа (для отметок «просмотрено» / «готово») */
	msgId?: string
	/** новый (не просмотрен) */
	unread: boolean
}

export interface AttentionList {
	permissions: AttentionItem[]
	errors: AttentionItem[]
	results: AttentionItem[]
	total: number
}

/** Отметки, хранятся в браузере. */
export interface AttentionMarks {
	/** результаты старше этого момента (мс) не показываем — чтобы не завалить старым при первом запуске */
	since: number
	/** просмотренные ответы (msgId) */
	seen: string[]
	/** обработанные («Готово») ответы (msgId) */
	done: string[]
}
