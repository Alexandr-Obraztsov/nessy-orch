/**
 * Чистая геометрия графа: кривые рёбер, дуги секторов, вписывание вида.
 */
import type { Size, Viewport } from '../model/types'

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export interface Pt {
	x: number
	y: number
}

/** Контрольная точка квадратичной кривой: изгиб вбок на долю длины. */
export function quadControl(a: Pt, b: Pt, bend = 0.16): Pt {
	const dx = b.x - a.x
	const dy = b.y - a.y
	return { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend }
}

export function quadPoint(a: Pt, c: Pt, b: Pt, t: number): Pt {
	const u = 1 - t
	return {
		x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
		y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
	}
}

const f1 = (n: number): string => n.toFixed(1)

export function quadPath(a: Pt, c: Pt, b: Pt): string {
	return `M${f1(a.x)} ${f1(a.y)}Q${f1(c.x)} ${f1(c.y)} ${f1(b.x)} ${f1(b.y)}`
}

export function linePath(a: Pt, b: Pt): string {
	return `M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}`
}

/** Ломаная по кривой между t0 и t1 (хвост «пакета»). */
export function quadSegment(a: Pt, c: Pt, b: Pt, t0: number, t1: number, steps = 8): string {
	let d = ''
	for (let i = 0; i <= steps; i++) {
		const p = quadPoint(a, c, b, t0 + ((t1 - t0) * i) / steps)
		d += `${i ? 'L' : 'M'}${f1(p.x)} ${f1(p.y)}`
	}
	return d
}

/** Дуга окружности радиуса r с центром в 0,0 от угла a0 до a1 (рад, по часовой). */
export function arcPath(r: number, a0: number, a1: number): string {
	const p0 = { x: Math.cos(a0) * r, y: Math.sin(a0) * r }
	const p1 = { x: Math.cos(a1) * r, y: Math.sin(a1) * r }
	const large = a1 - a0 > Math.PI ? 1 : 0
	return `M${f1(p0.x)} ${f1(p0.y)}A${f1(r)} ${f1(r)} 0 ${large} 1 ${f1(p1.x)} ${f1(p1.y)}`
}

/** Нормализация угла в (-π, π]. */
export function wrapAngle(a: number): number {
	let x = a
	while (x <= -Math.PI) x += Math.PI * 2
	while (x > Math.PI) x -= Math.PI * 2
	return x
}

/** Углы секторов пространств: равномерно по кругу, первый — сверху. */
export function sectorAngles(spaces: string[]): Map<string, number> {
	const out = new Map<string, number>()
	const n = spaces.length
	spaces.forEach((s, i) => out.set(s, -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, n)))
	return out
}

/** Радиус орбиты для глубины: растёт, если на орбите тесно. */
export function orbitRadius(depth: number, crowd: number): number {
	const base = 150 + (depth - 1) * 110
	return Math.max(base, (crowd * 62) / (Math.PI * 2))
}

export interface Bounds {
	x0: number
	y0: number
	x1: number
	y1: number
}

/** Вид, вписывающий прямоугольник мира в размер экрана с отступом. */
export function fitViewport(b: Bounds, size: Size, pad: number, minK: number, maxK: number): Viewport {
	const bw = Math.max(1, b.x1 - b.x0)
	const bh = Math.max(1, b.y1 - b.y0)
	const k = clamp(Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh), minK, maxK)
	const cx = (b.x0 + b.x1) / 2
	const cy = (b.y0 + b.y1) / 2
	return { k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k }
}

/** Масштаб вокруг экранной точки (px, py). */
export function zoomAt(v: Viewport, px: number, py: number, k: number): Viewport {
	const wx = (px - v.x) / v.k
	const wy = (py - v.y) / v.k
	return { k, x: px - wx * k, y: py - wy * k }
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
