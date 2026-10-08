/** Настройки вида графа (запоминаются в localStorage). */
import { useSyncExternalStore } from 'react'
import type { GraphSettings } from './types'

const KEY = 'nessy-orch:graph'
const DEFAULTS: GraphSettings = { showArchived: false, labels: false }

function load(): GraphSettings {
	try {
		const raw = localStorage.getItem(KEY)
		return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GraphSettings>) } : DEFAULTS
	} catch {
		return DEFAULTS
	}
}

let settings = load()
const listeners = new Set<() => void>()

export function setGraphSettings(patch: Partial<GraphSettings>): void {
	settings = { ...settings, ...patch }
	try {
		localStorage.setItem(KEY, JSON.stringify(settings))
	} catch {
		/* приватный режим */
	}
	for (const fn of listeners) fn()
}

export function useGraphSettings(): GraphSettings {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => settings,
	)
}
