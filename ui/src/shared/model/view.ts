/**
 * Состояние навигации UI: вкладки главной панели, левая панель, диалоги, настройки ленты.
 * Отдельно от данных сервера (store.ts). Вкладки и настройки ленты запоминаются в localStorage.
 */
import { useSyncExternalStore } from 'react'
import type { DialogKind, FeedOptions, Tab, ViewState } from './view.types'

const KEY = 'nessy-orch:view'
const FEED: Tab = { kind: 'feed' }

function restore(): Pick<ViewState, 'tabs' | 'active' | 'feed'> {
	const fallback = { tabs: [FEED], active: 0, feed: { agentChatter: false, system: false } }
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return fallback
		const v = JSON.parse(raw) as Partial<ViewState>
		const tabs = Array.isArray(v.tabs) && v.tabs.length ? v.tabs : fallback.tabs
		const active = typeof v.active === 'number' && v.active < tabs.length ? v.active : 0
		return { tabs, active, feed: { ...fallback.feed, ...v.feed } }
	} catch {
		return fallback
	}
}

let view: ViewState = { ...restore(), sidebarOpen: false, dialog: null, spawnPreset: null }
const listeners = new Set<() => void>()

function persist(): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ tabs: view.tabs, active: view.active, feed: view.feed }))
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

const sameTab = (a: Tab, b: Tab): boolean =>
	a.kind === b.kind && (a.kind === 'agent' || a.kind === 'role' ? a.id === (b as typeof a).id : true)

export function activeTab(v: ViewState = view): Tab {
	return v.tabs[v.active] ?? FEED
}

/** Открыть вкладку (или переключиться на уже открытую). На узких экранах закрывает левую панель. */
export function openTab(tab: Tab): void {
	const i = view.tabs.findIndex(t => sameTab(t, tab))
	if (i !== -1) setView({ active: i, sidebarOpen: false })
	else setView({ tabs: [...view.tabs, tab], active: view.tabs.length, sidebarOpen: false })
}

export function closeTab(index: number): void {
	const tabs = view.tabs.filter((_, i) => i !== index)
	if (!tabs.length) tabs.push(FEED)
	const active = index < view.active ? view.active - 1 : Math.min(view.active, tabs.length - 1)
	setView({ tabs, active })
}

/** Закрыть все вкладки, относящиеся к удалённому агенту/роли. */
export function closeTabsWhere(pred: (t: Tab) => boolean): void {
	const cur = activeTab()
	const tabs = view.tabs.filter(t => !pred(t))
	if (!tabs.length) tabs.push(FEED)
	const keep = tabs.findIndex(t => sameTab(t, cur))
	setView({ tabs, active: keep === -1 ? Math.max(0, tabs.length - 1) : keep })
}

export const openFeed = (): void => openTab(FEED)
export const openGraph = (): void => openTab({ kind: 'graph' })
export const openAgent = (id: string): void => openTab({ kind: 'agent', id })
export const openRole = (id: string | null): void => openTab({ kind: 'role', id })

export function openDialog(dialog: DialogKind, spawnPreset: ViewState['spawnPreset'] = null): void {
	setView({ dialog, spawnPreset })
}

export function setFeedOptions(patch: Partial<FeedOptions>): void {
	setView({ feed: { ...view.feed, ...patch } })
}

export function toggleSidebar(open?: boolean): void {
	setView({ sidebarOpen: open ?? !view.sidebarOpen })
}
