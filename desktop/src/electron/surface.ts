/** Общее для главного окна и поповера: что показывать (UI или страницу статуса) и защита навигации. */
import { shell, type BrowserWindow, type WebContents } from 'electron'
import { ARG_MODE, ARG_URL, IPC } from '../lib/ipc'
import { sameOrigin, uiUrl } from '../lib/urls'
import type { DesktopMode, ShellStatus } from '../preload.types'
import { staticPath } from './assets'

/** Что показывает окно: наш React-UI с сервера или локальную страницу статуса. */
export type View = { kind: 'ui'; base: string } | { kind: 'status'; status: ShellStatus }

export function webPreferences(preload: string, mode: DesktopMode, base: string): Electron.WebPreferences {
	return {
		preload,
		contextIsolation: true,
		sandbox: true,
		nodeIntegration: false,
		spellcheck: false,
		additionalArguments: [ARG_MODE + mode, ARG_URL + base],
	}
}

/** Внешние ссылки — в браузер; навигация внутри окна — только по оркестратору и локальным страницам. */
export function guardNavigation(wc: WebContents, base: () => string): void {
	const external = (url: string): void => {
		if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) void shell.openExternal(url)
	}
	wc.setWindowOpenHandler(({ url }) => {
		external(url)
		return { action: 'deny' }
	})
	wc.on('will-navigate', (e, url) => {
		if (sameOrigin(url, base()) || url.startsWith('file:')) return
		e.preventDefault()
		external(url)
	})
	wc.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'notifications'))
}

const onStatusPage = (win: BrowserWindow): boolean => win.webContents.getURL().startsWith('file:')

/**
 * Показать view в окне. UI грузится заново только если окно ещё не на нём или передан query;
 * страница статуса обновляется сообщением без перезагрузки.
 */
export function applyView(win: BrowserWindow, mode: DesktopMode, view: View, query = ''): void {
	if (win.isDestroyed()) return
	const wc = win.webContents
	if (view.kind === 'ui') {
		if (!query && sameOrigin(wc.getURL(), view.base) && !wc.isLoadingMainFrame()) return
		void wc.loadURL(uiUrl(view.base, mode, query)).catch(() => {
			/* ошибку загрузки обработает did-fail-load */
		})
		return
	}
	if (onStatusPage(win) && !wc.isLoadingMainFrame()) {
		wc.send(IPC.status, view.status)
		return
	}
	const { state, title, detail } = view.status
	void win.loadFile(staticPath('status.html'), { query: { desktop: mode, state, title, detail } }).catch(() => {
		/* страница статуса локальная — сюда не попадаем */
	})
}
