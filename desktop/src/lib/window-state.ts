/** Размер и позиция главного окна: проверка сохранённого состояния против текущих экранов. */
import type { Rect, Size, WindowState } from '../types'

export const MIN_SIZE: Size = { width: 900, height: 600 }
export const DEFAULT_SIZE: Size = { width: 1280, height: 820 }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

/** Разобрать сохранённый JSON; мусор → null. */
export function parseWindowState(raw: unknown): WindowState | null {
	if (typeof raw !== 'object' || raw === null) return null
	const o = raw as Record<string, unknown>
	const x = num(o['x'])
	const y = num(o['y'])
	const width = num(o['width'])
	const height = num(o['height'])
	if (x === null || y === null || width === null || height === null) return null
	return { x, y, width, height, maximized: o['maximized'] === true }
}

/** Площадь пересечения двух прямоугольников. */
function overlap(a: Rect, b: Rect): number {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
	return w > 0 && h > 0 ? w * h : 0
}

/** Окно по центру рабочей области основного экрана. */
export function centered(primary: Rect, size: Size = DEFAULT_SIZE): Rect {
	const width = Math.min(size.width, primary.width)
	const height = Math.min(size.height, primary.height)
	return {
		x: Math.round(primary.x + (primary.width - width) / 2),
		y: Math.round(primary.y + (primary.height - height) / 2),
		width,
		height,
	}
}

/**
 * Где открыть окно: сохранённое место, если оно заметно видно на одном из экранов
 * (иначе — экран отключили), с подрезкой размера до минимума и до экрана.
 */
export function restoreBounds(saved: WindowState | null, displays: Rect[], primary: Rect): Rect {
	if (!saved) return centered(primary)
	let best: Rect | null = null
	let bestArea = 0
	for (const d of displays) {
		const a = overlap(saved, d)
		if (a > bestArea) {
			bestArea = a
			best = d
		}
	}
	// видно меньше четверти окна или меньше 120×80 — не угадываем, ставим по центру
	if (!best || bestArea < Math.max(120 * 80, (saved.width * saved.height) / 4)) return centered(primary, saved)
	const width = Math.min(Math.max(saved.width, MIN_SIZE.width), best.width)
	const height = Math.min(Math.max(saved.height, MIN_SIZE.height), best.height)
	const x = Math.min(Math.max(saved.x, best.x), best.x + best.width - width)
	const y = Math.min(Math.max(saved.y, best.y), best.y + best.height - height)
	return { x, y, width, height }
}
