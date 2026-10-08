/** Геометрия вида графа: вписывание, масштаб вокруг точки. */
import type { Size, Viewport } from '../model/types'

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export interface Pt {
	x: number
	y: number
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

/** Радиус узла по числу сообщений: 5…8 (логарифмически). */
export function nodeRadius(weight: number): number {
	return 5 + Math.min(3, Math.log2(1 + weight) * 0.7)
}

/** Соседи узла (включая сам узел). */
export function neighborsOf(id: string | null, edges: { a: string; b: string }[]): Set<string> {
	const out = new Set<string>()
	if (!id) return out
	out.add(id)
	for (const e of edges) {
		if (e.a === id) out.add(e.b)
		else if (e.b === id) out.add(e.a)
	}
	return out
}
