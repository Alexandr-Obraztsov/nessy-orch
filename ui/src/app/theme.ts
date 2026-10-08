/**
 * Тема: системная по умолчанию, ручной выбор сохраняется в localStorage.
 */
import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'nessy-orch:theme'
const listeners = new Set<() => void>()

function stored(): Theme | null {
	try {
		const v = localStorage.getItem(KEY)
		return v === 'dark' || v === 'light' ? v : null
	} catch {
		return null
	}
}

function system(): Theme {
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function currentTheme(): Theme {
	return stored() ?? system()
}

export function initTheme(): void {
	const t = stored()
	if (t) document.documentElement.dataset['theme'] = t
}

export function toggleTheme(): void {
	const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
	try {
		localStorage.setItem(KEY, next)
	} catch {
		/* приватный режим — тема не запомнится */
	}
	document.documentElement.dataset['theme'] = next
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0a1116' : '#f3f1ea')
	for (const fn of listeners) fn()
}

export function useTheme(): Theme {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			const m = window.matchMedia('(prefers-color-scheme: light)')
			m.addEventListener('change', fn)
			return () => {
				listeners.delete(fn)
				m.removeEventListener('change', fn)
			}
		},
		currentTheme,
	)
}
