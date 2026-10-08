/**
 * Состояние навигации UI (что выбрано и что открыто). Отдельно от данных сервера.
 */
import { useSyncExternalStore } from 'react'
import type { MobileTab, ViewState } from './view.types'

let view: ViewState = { selectedAgentId: null, mobileTab: 'graph', dialog: null, feedFilter: 'all' }
const listeners = new Set<() => void>()

export function setView(patch: Partial<ViewState>): void {
	view = { ...view, ...patch }
	for (const fn of listeners) fn()
}

export function getView(): ViewState {
	return view
}

export function useView<T>(selector: (v: ViewState) => T): T {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => selector(view),
	)
}

/** Открыть чат агента (на мобильных — переключиться на вкладку чата). */
export function openAgent(id: string): void {
	setView({ selectedAgentId: id, mobileTab: 'chat' })
}

export function closeAgent(): void {
	setView({ selectedAgentId: null, mobileTab: view.mobileTab === 'chat' ? 'agents' : view.mobileTab })
}

export function openDialog(dialog: ViewState['dialog']): void {
	setView({ dialog })
}

export function setMobileTab(tab: MobileTab): void {
	setView({ mobileTab: tab })
}
