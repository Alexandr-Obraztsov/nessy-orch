/**
 * Просмотренные результаты (временное локальное хранилище, пока нет общего в entities/attention):
 * id ответов, которые оператор отметил просмотренными. Живёт в localStorage.
 */
import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'nessy-orch:seen-replies'
const listeners = new Set<() => void>()

function load(): Set<string> {
	try {
		const raw = localStorage.getItem(KEY)
		const v: unknown = raw ? JSON.parse(raw) : []
		return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
	} catch {
		return new Set()
	}
}

let seen = load()

export function markSeen(msgId: string): void {
	if (seen.has(msgId)) return
	seen = new Set([...seen, msgId].slice(-500))
	try {
		localStorage.setItem(KEY, JSON.stringify([...seen]))
	} catch {
		/* приватный режим — запомним до перезагрузки */
	}
	for (const fn of listeners) fn()
}

export function useSeen(): (msgId: string) => boolean {
	const snap = useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => seen,
	)
	return useCallback((id: string) => snap.has(id), [snap])
}
