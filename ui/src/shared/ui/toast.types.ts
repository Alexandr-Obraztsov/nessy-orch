export type ToastKind = 'info' | 'success' | 'error' | 'warn'

export interface Toast {
	id: number
	kind: ToastKind
	text: string
	/** ключ склейки одинаковых уведомлений */
	group?: string
	/** текст без счётчика склейки */
	base?: string
	/** сколько ещё событий склеено в это уведомление */
	extra?: number
}
