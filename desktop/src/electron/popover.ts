/** Поповер из строки меню: стеклянное окно без рамки под иконкой, прячется при потере фокуса. */
import { BrowserWindow, screen } from 'electron'
import { popoverPosition } from '../lib/popover-position'
import type { Rect, Size } from '../types'
import { applyView, guardNavigation, webPreferences, type View } from './surface'

export const POPOVER_SIZE: Size = { width: 400, height: 560 }
/** Клик по иконке сразу после скрытия по blur — это тот же клик, а не повторное открытие. */
const REOPEN_GUARD_MS = 250
const FADE_MS = 140
const FADE_STEPS = 7

export interface PopoverDeps {
	preload: string
	base(): string
	view(): View
}

export class Popover {
	private win: BrowserWindow | null = null
	private hiddenAt = 0
	private fade: NodeJS.Timeout | null = null

	constructor(private readonly deps: PopoverDeps) {}

	get isVisible(): boolean {
		return this.win !== null && !this.win.isDestroyed() && this.win.isVisible()
	}

	get isFocused(): boolean {
		return this.isVisible && (this.win?.isFocused() ?? false)
	}

	/** Создать заранее, чтобы первый клик открывал поповер мгновенно. */
	warmUp(): void {
		this.ensure()
	}

	toggle(tray: Rect | null): void {
		if (this.isVisible) {
			this.hide()
			return
		}
		if (Date.now() - this.hiddenAt < REOPEN_GUARD_MS) return
		this.show(tray)
	}

	show(tray: Rect | null): void {
		const win = this.ensure()
		const cursor = screen.getCursorScreenPoint()
		const anchor: Rect = tray ?? { x: cursor.x, y: 0, width: 0, height: 0 }
		const display = screen.getDisplayNearestPoint(tray ? { x: tray.x + tray.width / 2, y: tray.y + tray.height / 2 } : cursor)
		const pos = popoverPosition(anchor, POPOVER_SIZE, display.workArea, cursor)
		win.setBounds({ ...pos, ...POPOVER_SIZE })
		win.setOpacity(0)
		win.show()
		win.focus()
		this.animate(win, 1)
	}

	hide(): void {
		const win = this.win
		if (!win || win.isDestroyed() || !win.isVisible()) return
		this.hiddenAt = Date.now()
		this.animate(win, 0, () => win.hide())
	}

	render(): void {
		if (this.win && !this.win.isDestroyed()) applyView(this.win, 'popover', this.deps.view())
	}

	reload(): void {
		if (this.win && !this.win.isDestroyed()) applyView(this.win, 'popover', this.deps.view(), '?')
	}

	destroy(): void {
		this.win?.destroy()
		this.win = null
	}

	/** Плавное появление/исчезание: несколько шагов прозрачности за ~140 мс. */
	private animate(win: BrowserWindow, to: number, done?: () => void): void {
		if (this.fade) clearInterval(this.fade)
		const from = win.getOpacity()
		let step = 0
		this.fade = setInterval(() => {
			step++
			if (win.isDestroyed()) {
				if (this.fade) clearInterval(this.fade)
				return
			}
			const t = Math.min(1, step / FADE_STEPS)
			const eased = 1 - Math.pow(1 - t, 3)
			win.setOpacity(from + (to - from) * eased)
			if (t >= 1) {
				if (this.fade) clearInterval(this.fade)
				this.fade = null
				done?.()
			}
		}, FADE_MS / FADE_STEPS)
	}

	private ensure(): BrowserWindow {
		if (this.win && !this.win.isDestroyed()) return this.win
		const win = new BrowserWindow({
			...POPOVER_SIZE,
			show: false,
			frame: false,
			transparent: true,
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			alwaysOnTop: true,
			hasShadow: true,
			roundedCorners: true,
			vibrancy: 'popover',
			visualEffectState: 'active',
			backgroundColor: '#00000000',
			webPreferences: webPreferences(this.deps.preload, 'popover', this.deps.base()),
		})
		win.setAlwaysOnTop(true, 'pop-up-menu')
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
		guardNavigation(win.webContents, () => this.deps.base())
		win.on('blur', () => this.hide())
		win.on('closed', () => {
			this.win = null
		})
		this.win = win
		applyView(win, 'popover', this.deps.view())
		return win
	}
}
