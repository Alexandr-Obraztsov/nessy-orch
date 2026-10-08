/**
 * Какие ответы в ленте раскрыты. Живёт в памяти вкладки браузера: переживает переключение
 * вкладок и перерисовки ленты, но не перезагрузку страницы.
 */
import { useCallback, useSyncExternalStore } from 'react'

const open = new Set<string>()
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	return () => {
		listeners.delete(fn)
	}
}

export function toggleExpanded(id: string, value = !open.has(id)): void {
	if (value) open.add(id)
	else open.delete(id)
	for (const fn of listeners) fn()
}

export function useExpanded(id: string): [boolean, (value?: boolean) => void] {
	const expanded = useSyncExternalStore(subscribe, () => open.has(id))
	const toggle = useCallback((value?: boolean) => toggleExpanded(id, value), [id])
	return [expanded, toggle]
}
