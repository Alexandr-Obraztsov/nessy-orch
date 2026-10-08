/**
 * Всплывающие уведомления (ошибки API, подтверждения действий).
 */
import { useSyncExternalStore } from 'react'
import type { Toast, ToastKind } from './toast.types'

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = (): void => {
	for (const fn of listeners) fn()
}

export function toast(text: string, kind: ToastKind = 'info', ttl = 4200): void {
	const id = nextId++
	toasts = [...toasts.slice(-3), { id, kind, text }]
	emit()
	window.setTimeout(() => dismissToast(id), ttl)
}

export function dismissToast(id: number): void {
	toasts = toasts.filter(t => t.id !== id)
	emit()
}

export function useToasts(): Toast[] {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => toasts,
	)
}
