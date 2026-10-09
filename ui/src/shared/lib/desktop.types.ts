/**
 * Контракт с оболочкой Electron (desktop/): preload кладёт в окно объект `window.nessyDesktop`.
 * В обычном браузере его нет — UI работает как веб-панель.
 */

/** главное окно (vibrancy) или поповер из строки меню */
export type DesktopMode = 'window' | 'popover'

export interface NessyDesktop {
	isDesktop: true
	/** process.platform оболочки: darwin, win32, linux */
	platform: string
	mode: DesktopMode
	/** показать главное окно; query — «?task=…&agent=…» */
	openMain(query?: string): void
	/** спрятать поповер (после перехода в главное окно) */
	hidePopover(): void
	orchestrator: { url: string }
}

/** Что UI знает об оболочке: режим есть и без preload (запасной признак ?desktop=window|popover). */
export interface DesktopInfo {
	mode: DesktopMode | null
	platform: string
	/** открыть вид в главном окне (в браузере — в этой же вкладке) */
	openMain(query?: string): void
	hidePopover(): void
}

declare global {
	interface Window {
		nessyDesktop?: NessyDesktop
	}
}
