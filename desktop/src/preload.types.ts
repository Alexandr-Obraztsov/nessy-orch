/**
 * Контракт между оболочкой Electron и React-UI. Preload кладёт объект в `window.nessyDesktop`,
 * UI читает его (если объекта нет — UI смотрит на query-параметр `?desktop=window|popover`).
 */

/** Где открыт UI: главное окно или поповер из строки меню. */
export type DesktopMode = 'window' | 'popover'

/** `window.nessyDesktop` — есть только внутри приложения. */
export interface NessyDesktop {
	isDesktop: true
	/** process.platform */
	platform: string
	mode: DesktopMode
	/** открыть или сфокусировать главное окно; query вида '?task=a&agent=b' */
	openMain(query?: string): void
	hidePopover(): void
	orchestrator: { url: string }
}

/** Состояние локальной страницы `static/status.html` (запуск или ошибка оркестратора). */
export interface ShellStatus {
	state: 'starting' | 'error'
	title: string
	detail: string
}

/**
 * `window.nessyShell` — только на локальной странице статуса (file://), не в UI:
 * кнопки «Повторить» и «Выйти» и текущее состояние.
 */
export interface NessyShell {
	retry(): void
	quit(): void
	/** подписка на смену состояния; возвращает отписку */
	onStatus(listener: (status: ShellStatus) => void): () => void
}
