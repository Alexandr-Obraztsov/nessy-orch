export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
	id: number
	kind: ToastKind
	text: string
}
