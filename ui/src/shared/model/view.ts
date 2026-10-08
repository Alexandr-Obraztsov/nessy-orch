/**
 * Состояние навигации UI: страница, выбранный агент, фильтры, журнал, диалоги.
 * Отдельно от данных сервера (store.ts). Настройки вида запоминаются в localStorage.
 */
import { useSyncExternalStore } from 'react'
import type { DialogKind, Grouping, MobileTab, Page, StatusFilter, ViewState } from './view.types'

const KEY = 'nessy-orch:view-v3'

type Persisted = Pick<ViewState, 'grouping' | 'collapsed' | 'journalOpen'>

function restore(): Persisted {
	const fallback: Persisted = { grouping: 'tasks', collapsed: [], journalOpen: false }
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return fallback
		const v = JSON.parse(raw) as Partial<Persisted>
		return {
			grouping: v.grouping ?? fallback.grouping,
			collapsed: Array.isArray(v.collapsed) ? v.collapsed : [],
			journalOpen: v.journalOpen === true,
		}
	} catch {
		return fallback
	}
}

let view: ViewState = {
	page: { kind: 'main' },
	selectedAgentId: null,
	filter: 'all',
	search: '',
	mobileTab: 'tasks',
	dialog: null,
	spawnPreset: null,
	...restore(),
}
const listeners = new Set<() => void>()

function persist(): void {
	try {
		const p: Persisted = { grouping: view.grouping, collapsed: view.collapsed, journalOpen: view.journalOpen }
		localStorage.setItem(KEY, JSON.stringify(p))
	} catch {
		/* приватный режим — не запомним */
	}
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

/** Открыть детали агента (на рабочей странице). */
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

export function openDialog(dialog: DialogKind, spawnPreset: ViewState['spawnPreset'] = null): void {
	setView({ dialog, spawnPreset })
}

export function setFilter(filter: StatusFilter): void {
	// повторный клик по тому же счётчику снимает фильтр
	setView({ filter: view.filter === filter ? 'all' : filter })
}

export const setGrouping = (grouping: Grouping): void => setView({ grouping })
export const setSearch = (search: string): void => setView({ search })
export const setMobileTab = (mobileTab: MobileTab): void => setView({ mobileTab })
export const toggleJournal = (open?: boolean): void => setView({ journalOpen: open ?? !view.journalOpen })

export function toggleCollapsed(taskId: string): void {
	const has = view.collapsed.includes(taskId)
	setView({ collapsed: has ? view.collapsed.filter(x => x !== taskId) : [...view.collapsed, taskId] })
}
