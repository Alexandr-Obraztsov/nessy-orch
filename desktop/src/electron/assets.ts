/** Пути к ресурсам приложения и иконки строки меню. */
import { app, nativeImage, type NativeImage } from 'electron'
import * as path from 'node:path'
import { PULSE_FRAMES } from '../lib/tray-state'

/** Корень пакета desktop/ (в dev) или app.asar (в собранном приложении). */
export const appDir = (): string => app.getAppPath()
export const assetPath = (...p: string[]): string => path.join(appDir(), 'assets', ...p)
export const staticPath = (...p: string[]): string => path.join(appDir(), 'static', ...p)

/**
 * Кадры пульса иконки ✻ (template: macOS сам красит их под светлую/тёмную строку меню).
 * Файлы tray-<n>Template.png и @2x рядом — Electron подхватывает @2x на Retina.
 */
export function trayFrames(): NativeImage[] {
	const frames: NativeImage[] = []
	for (let i = 0; i < PULSE_FRAMES; i++) {
		const img = nativeImage.createFromPath(assetPath('tray', `tray-${i}Template.png`))
		img.setTemplateImage(true)
		frames.push(img)
	}
	return frames
}

/** Корень собранного nessy-orch: настройка → NESSY_ORCH_ROOT → ресурсы .app → репозиторий рядом. */
export function serverRoot(setting: string | null): string {
	if (setting) return setting
	const env = process.env['NESSY_ORCH_ROOT']
	if (env) return env
	if (app.isPackaged) return path.join(process.resourcesPath, 'server')
	return path.resolve(appDir(), '..')
}
