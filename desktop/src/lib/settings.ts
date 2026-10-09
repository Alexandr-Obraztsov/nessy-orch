/** Настройки приложения: разбор settings.json с дефолтами. */
import type { DockSetting, Settings, ThemeSetting } from '../types'

export const DEFAULT_SETTINGS: Settings = {
	theme: 'system',
	dock: 'auto',
	notifications: true,
	openAtLogin: false,
	serverRoot: null,
}

const THEMES: readonly ThemeSetting[] = ['system', 'light', 'dark']
const DOCKS: readonly DockSetting[] = ['auto', 'always', 'never']

const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => list.find(x => x === v) ?? d

export function parseSettings(raw: unknown): Settings {
	if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
	const o = raw as Record<string, unknown>
	const root = o['serverRoot']
	return {
		theme: oneOf(THEMES, o['theme'], DEFAULT_SETTINGS.theme),
		dock: oneOf(DOCKS, o['dock'], DEFAULT_SETTINGS.dock),
		notifications: typeof o['notifications'] === 'boolean' ? o['notifications'] : DEFAULT_SETTINGS.notifications,
		openAtLogin: typeof o['openAtLogin'] === 'boolean' ? o['openAtLogin'] : DEFAULT_SETTINGS.openAtLogin,
		serverRoot: typeof root === 'string' && root.trim() ? root : null,
	}
}

/** Показывать ли значок в Dock. */
export function dockVisible(setting: DockSetting, mainWindowOpen: boolean): boolean {
	return setting === 'always' || (setting === 'auto' && mainWindowOpen)
}
