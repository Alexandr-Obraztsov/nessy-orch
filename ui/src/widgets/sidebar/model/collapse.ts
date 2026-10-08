/** Свёрнутые секции и папки левой панели (запоминаются). Архив по умолчанию свёрнут. */
import { useSyncExternalStore } from 'react'
import type { CollapseState, SectionId } from './types'

const KEY = 'nessy-orch:sidebar'
const DEFAULTS: CollapseState = { sections: { archive: true }, folders: {} }

function load(): CollapseState {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return DEFAULTS
		const v = JSON.parse(raw) as Partial<CollapseState>
		return { sections: { ...DEFAULTS.sections, ...v.sections }, folders: { ...v.folders } }
	} catch {
		return DEFAULTS
	}
}

let state = load()
const listeners = new Set<() => void>()

function set(next: CollapseState): void {
	state = next
	try {
		localStorage.setItem(KEY, JSON.stringify(state))
	} catch {
		/* приватный режим */
	}
	for (const fn of listeners) fn()
}

export function toggleSection(id: SectionId): void {
	set({ ...state, sections: { ...state.sections, [id]: !state.sections[id] } })
}

export function toggleFolder(key: string): void {
	set({ ...state, folders: { ...state.folders, [key]: !state.folders[key] } })
}

export function useCollapse(): CollapseState {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => state,
	)
}
