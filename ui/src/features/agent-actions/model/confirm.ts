/**
 * Ожидающее подтверждение удаления агента. Одно на приложение: диалог рисует
 * AgentConfirmHost (смонтирован в App), а запросить его можно откуда угодно.
 */
import { useSyncExternalStore } from 'react'
import type { AgentView } from '@contract'

let pending: AgentView | null = null
const listeners = new Set<() => void>()

export function askRemove(agent: AgentView | null): void {
	pending = agent
	for (const fn of listeners) fn()
}

export function usePendingRemove(): AgentView | null {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => pending,
	)
}
