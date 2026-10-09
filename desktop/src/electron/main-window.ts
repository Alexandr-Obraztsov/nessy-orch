/** Главное окно: стекло под всем окном, кнопки светофора в сайдбаре, запоминание размера и места. */
import { BrowserWindow, screen } from 'electron'
import type { WindowState } from '../types'
import { MIN_SIZE, restoreBounds } from '../lib/window-state'
import type { JsonFile } from './store'
import { applyView, guardNavigation, webPreferences, type View } from './surface'

export interface MainWindowDeps {
	preload: string
	base(): string
	view(): View
	stateFile: JsonFile<WindowState | null>
	/** окно открылось или закрылось (для значка в Dock) */
	onOpenChange(open: boolean): void
	/** UI не загрузился (сервер пропал) */
	onLoadFailed(): void
}

/** Кнопки светофора — по центру шапки сайдбара. */
const TRAFFIC_LIGHTS = { x: 18, y: 18 }

export class MainWindow {
	private win: BrowserWindow | null = null

	constructor(private readonly deps: MainWindowDeps) {}

	get isOpen(): boolean {
		return this.win !== null && !this.win.isDestroyed()
	}

	get isFocused(): boolean {
		return this.isOpen && (this.win?.isFocused() ?? false)
	}

	/** Открыть или сфокусировать; query — открыть UI на нужной задаче или агенте. */
	open(query = ''): void {
		const existing = this.win
		if (existing && !existing.isDestroyed()) {
			if (query) applyView(existing, 'window', this.deps.view(), query)
			if (existing.isMinimized()) existing.restore()
			existing.show()
			existing.focus()
			return
		}
		this.win = this.create(query)
		this.deps.onOpenChange(true)
	}

	/** Показать текущее состояние (UI или статус). */
	render(): void {
		if (this.win && !this.win.isDestroyed()) applyView(this.win, 'window', this.deps.view())
	}

	/** Перезагрузить UI (после перезапуска оркестратора). */
	reload(): void {
		if (this.win && !this.win.isDestroyed()) applyView(this.win, 'window', this.deps.view(), '?')
	}

	close(): void {
		this.win?.close()
	}

	private create(query: string): BrowserWindow {
		const display = screen.getPrimaryDisplay()
		const bounds = restoreBounds(
			this.deps.stateFile.read(),
			screen.getAllDisplays().map(d => d.workArea),
			display.workArea,
		)
		const saved = this.deps.stateFile.read()
		const win = new BrowserWindow({
			...bounds,
			minWidth: MIN_SIZE.width,
			minHeight: MIN_SIZE.height,
			show: false,
			title: 'nessy',
			titleBarStyle: 'hiddenInset',
			trafficLightPosition: TRAFFIC_LIGHTS,
			// стекло: системный материал под всем окном, прозрачный фон страницы
			vibrancy: 'under-window',
			visualEffectState: 'followWindow',
			backgroundColor: '#00000000',
			roundedCorners: true,
			fullscreenable: true,
			webPreferences: webPreferences(this.deps.preload, 'window', this.deps.base()),
		})
		guardNavigation(win.webContents, () => this.deps.base())
		win.once('ready-to-show', () => {
			if (saved?.maximized) win.maximize()
			win.show()
		})
		const remember = (): void => {
			if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
			const b = win.getNormalBounds()
			this.deps.stateFile.write({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
		}
		win.on('resize', remember)
		win.on('move', remember)
		win.on('maximize', remember)
		win.on('unmaximize', remember)
		win.on('close', () => {
			remember()
			this.deps.stateFile.flush()
		})
		win.on('closed', () => {
			this.win = null
			this.deps.onOpenChange(false)
		})
		win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
			// -3 — загрузку прервали новой навигацией, это не ошибка
			if (isMainFrame && code !== -3 && !url.startsWith('file:')) this.deps.onLoadFailed()
		})
		applyView(win, 'window', this.deps.view(), query)
		return win
	}
}
