/**
 * Всплывающие уведомления (ошибки API, подтверждения действий, «ждёт вас»).
 * Уведомления одной группы склеиваются: «… · +3», а время показа продлевается.
 */
import { useSyncExternalStore } from 'react'
import type { Toast, ToastKind } from './toast.types'

let toasts: Toast[] = []
let nextId = 1
const timers = new Map<number, number>()
const listeners = new Set<() => void>()
const emit = (): void => {
	for (const fn of listeners) fn()
}

function schedule(id: number, ttl: number): void {
	window.clearTimeout(timers.get(id))
	timers.set(
		id,
		window.setTimeout(() => dismissToast(id), ttl),
	)
}

/**
 * @param group  ключ склейки: пока тост группы на экране, новые добавляются к нему счётчиком
 * @param count  сколько событий несёт это уведомление (для счётчика склейки)
 */
export function toast(text: string, kind: ToastKind = 'info', ttl = 4200, group?: string, count = 1): void {
	const same = group ? toasts.find(t => t.group === group) : undefined
	if (same) {
		const extra = (same.extra ?? 0) + count
		toasts = toasts.map(t => (t.id === same.id ? { ...t, extra, text: `${t.base ?? t.text} · +${extra}` } : t))
		schedule(same.id, ttl)
		emit()
		return
	}
	const id = nextId++
	const extra = count - 1
	toasts = [...toasts.slice(-3), { id, kind, text: extra > 0 ? `${text} · +${extra}` : text, group, base: text, extra }]
	schedule(id, ttl)
	emit()
}

export function dismissToast(id: number): void {
	window.clearTimeout(timers.get(id))
	timers.delete(id)
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
