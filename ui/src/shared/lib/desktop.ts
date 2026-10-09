/**
 * Оболочка Electron: режим окна (главное со стеклом / поповер из строки меню), платформа и действия
 * оболочки. Режим берётся из `window.nessyDesktop`, запасной признак — `?desktop=window|popover`.
 * initDesktop() ставит на <html> data-desktop и data-platform — по ним включается стеклянная тема.
 */
import type { DesktopInfo, DesktopMode } from './desktop.types'

function modeOf(): DesktopMode | null {
	const shell = window.nessyDesktop
	if (shell?.isDesktop) return shell.mode
	const q = new URLSearchParams(window.location.search).get('desktop')
	return q === 'window' || q === 'popover' ? q : null
}

// режим не меняется за жизнь страницы — вычисляем один раз
let cached: DesktopInfo | null = null

export function desktop(): DesktopInfo {
	if (cached) return cached
	const shell = window.nessyDesktop
	cached = {
		mode: modeOf(),
		platform: shell?.platform ?? (/Mac OS X|Macintosh/.test(navigator.userAgent) ? 'darwin' : 'web'),
		openMain(query = '') {
			if (shell) shell.openMain(query)
			else window.location.assign(`${window.location.pathname}${query.startsWith('?') || !query ? query : `?${query}`}`)
		},
		hidePopover() {
			shell?.hidePopover()
		},
	}
	return cached
}

/** Хук для компонентов: то же, что desktop(), значение стабильно. */
export function useDesktop(): DesktopInfo {
	return desktop()
}

/**
 * Базовый адрес API: в оболочке UI может быть загружен не с оркестратора (file://) —
 * тогда запросы идут на orchestrator.url; иначе пути относительные, как раньше.
 */
export function apiUrl(path: string): string {
	const url = window.nessyDesktop?.orchestrator.url
	if (!url) return path
	try {
		const base = new URL(url)
		if (base.origin === window.location.origin) return path
		return new URL(path, base).toString()
	} catch {
		return path
	}
}

export function initDesktop(): void {
	const d = desktop()
	const root = document.documentElement
	if (d.mode) root.dataset['desktop'] = d.mode
	root.dataset['platform'] = d.platform
}
