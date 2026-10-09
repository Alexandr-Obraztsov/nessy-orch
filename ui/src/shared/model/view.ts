/**
 * Состояние навигации UI: страница, выбранный агент, фильтр, «скрыть выполненные», свёрнутые группы.
 * Отдельно от данных сервера (store.ts). Настройки вида запоминаются в localStorage.
 */
import { useSyncExternalStore } from 'react'
import { readStorage, writeStorage } from '@/shared/lib/storage'
import type { DialogKind, GroupKey, Page, StatusFilter, ViewState } from './view.types'

const KEY = 'nessy-orch:view-v4'

type Persisted = Pick<ViewState, 'hideDone' | 'collapsed'>

const isGroup = (v: unknown): v is GroupKey => v === 'work' || v === 'done'

function restore(): Persisted {
	const fallback: Persisted = { hideDone: false, collapsed: [] }
	const raw = readStorage(KEY)
	if (!raw) return fallback
	try {
		const v = JSON.parse(raw) as Partial<Record<keyof Persisted, unknown>>
		return {
			hideDone: v.hideDone === true,
			collapsed: Array.isArray(v.collapsed) ? v.collapsed.filter(isGroup) : [],
		}
	} catch {
		return fallback
	}
}

let view: ViewState = {
	page: { kind: 'main' },
	selectedAgentId: null,
	filter: 'all',
	dialog: null,
	...restore(),
}
const listeners = new Set<() => void>()

function persist(): void {
	const p: Persisted = { hideDone: view.hideDone, collapsed: view.collapsed }
	writeStorage(KEY, JSON.stringify(p))
}

export function setView(patch: Partial<ViewState>): void {
	view = { ...view, ...patch }
	persist()
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

/** Открыть детали агента (на главной странице). */
export function openAgent(id: string): void {
	setView({ page: { kind: 'main' }, selectedAgentId: id })
}

export function closeAgent(): void {
	setView({ selectedAgentId: null })
}

export function openPage(page: Page): void {
	setView({ page })
}

export const openRole = (roleId: string | null): void => openPage({ kind: 'roles', roleId })

export function openDialog(dialog: DialogKind): void {
	setView({ dialog })
}

export function setFilter(filter: StatusFilter): void {
	// повторный клик по тому же чипу снимает фильтр
	setView({ filter: view.filter === filter ? 'all' : filter })
}

export const setHideDone = (hideDone: boolean): void => setView({ hideDone })

export function toggleCollapsed(group: GroupKey): void {
	const has = view.collapsed.includes(group)
	setView({ collapsed: has ? view.collapsed.filter(x => x !== group) : [...view.collapsed, group] })
}
