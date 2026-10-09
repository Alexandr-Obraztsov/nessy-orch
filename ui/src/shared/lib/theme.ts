/**
 * Тема: тёмная по умолчанию, ручной выбор сохраняется в localStorage.
 * Атрибут data-theme на <html> ставится всегда — токены (tokens.css) смотрят только на него.
 */
import { useSyncExternalStore } from 'react'
import { readStorage, writeStorage } from './storage'

export type Theme = 'dark' | 'light'
const KEY = 'nessy-orch:theme'
const listeners = new Set<() => void>()

function stored(): Theme | null {
	const v = readStorage(KEY)
	return v === 'dark' || v === 'light' ? v : null
}

export function currentTheme(): Theme {
	return stored() ?? 'dark'
}

function apply(t: Theme): void {
	document.documentElement.dataset['theme'] = t
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0d11' : '#f4f6f9')
	for (const fn of listeners) fn()
}

export function initTheme(): void {
	apply(currentTheme())
}

export function toggleTheme(): void {
	const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
	writeStorage(KEY, next)
	apply(next)
}

export function useTheme(): Theme {
	return useSyncExternalStore(fn => {
		listeners.add(fn)
		return () => {
			listeners.delete(fn)
		}
	}, currentTheme)
}
