/** Иконка ✻ в строке меню: число работающих агентов, «●» при запросе разрешения, мягкий пульс. */
import { Tray, type Menu, type NativeImage } from 'electron'
import { PULSE_INTERVAL_MS, pulseFrame, trayTitle, trayTooltip } from '../lib/tray-state'
import type { Rect, TrayStatus } from '../types'

export interface TrayDeps {
	frames: NativeImage[]
	onClick(bounds: Rect): void
	menu(): Menu
}

export class StatusTray {
	private readonly tray: Tray
	private timer: NodeJS.Timeout | null = null
	private tick = 0
	private frame = 0

	constructor(private readonly deps: TrayDeps) {
		const first = deps.frames[0]
		if (!first) throw new Error('нет кадров иконки строки меню')
		this.tray = new Tray(first)
		this.tray.setIgnoreDoubleClickEvents(true)
		this.tray.on('click', (_e, bounds) => deps.onClick(bounds))
		this.tray.on('right-click', () => this.tray.popUpContextMenu(deps.menu()))
		this.update({ working: 0, waiting: 0, agents: 0 }, true)
	}

	get bounds(): Rect {
		return this.tray.getBounds()
	}

	update(s: TrayStatus, offline: boolean): void {
		this.tray.setTitle(trayTitle(s), { fontType: 'monospacedDigit' })
		this.tray.setToolTip(trayTooltip(s, offline))
		this.pulse(s.working > 0 && !offline)
	}

	destroy(): void {
		this.pulse(false)
		this.tray.destroy()
	}

	/** Пока агенты работают — «дыхание» иконки, не чаще 4 кадров в секунду. */
	private pulse(active: boolean): void {
		if (active && !this.timer) {
			this.timer = setInterval(() => this.setFrame(pulseFrame(++this.tick, true, this.deps.frames.length)), PULSE_INTERVAL_MS)
		} else if (!active && this.timer) {
			clearInterval(this.timer)
			this.timer = null
			this.tick = 0
			this.setFrame(0)
		}
	}

	private setFrame(i: number): void {
		if (i === this.frame) return
		const img = this.deps.frames[i]
		if (!img) return
		this.frame = i
		this.tray.setImage(img)
	}
}
