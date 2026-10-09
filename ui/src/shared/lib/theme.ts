/**
 * Тема: по умолчанию системная (prefers-color-scheme), ручной выбор (светлая / тёмная) запоминается
 * в localStorage. Атрибут data-theme на <html> ставится всегда — токены (tokens.css) смотрят только на него.
 */
import { useSyncExternalStore } from 'react'
import { readStorage, writeStorage } from './storage'
import type { Theme, ThemePref } from './theme.types'

const KEY = 'nessy-orch:theme'
const DARK = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()

function stored(): ThemePref {
	const v = readStorage(KEY)
	return v === 'dark' || v === 'light' ? v : 'system'
}

export function themePref(): ThemePref {
	return stored()
}

export function currentTheme(): Theme {
	const p = stored()
	if (p !== 'system') return p
	return window.matchMedia(DARK).matches ? 'dark' : 'light'
}

function apply(): void {
	const t = currentTheme()
	document.documentElement.dataset['theme'] = t
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#1f1e1d' : '#f5f4ed')
	for (const fn of listeners) fn()
}

export function initTheme(): void {
	apply()
	window.matchMedia(DARK).addEventListener('change', () => {
		if (stored() === 'system') apply()
	})
}

/** Системная → светлая → тёмная → системная. */
export function cycleTheme(): void {
	const next: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
	writeStorage(KEY, next[stored()])
	apply()
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	return () => {
		listeners.delete(fn)
	}
}

export function useThemePref(): ThemePref {
	return useSyncExternalStore(subscribe, stored)
}
