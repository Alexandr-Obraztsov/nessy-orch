/**
 * Жесты на SVG графа через pointer events: перетаскивание фона (пан), щипок (зум),
 * перетаскивание узла (временно фиксирует fx/fy), тап по узлу. Колесо — зум вокруг курсора.
 */
import { YOU } from '@/shared/model'
import { type Pt, clamp, zoomAt } from '../lib/geometry'
import type { SimNode, Viewport } from './types'

export const MIN_K = 0.3
export const MAX_K = 2.6
/** порог сдвига, после которого нажатие считается перетаскиванием, а не тапом */
const TAP_SLOP = 5

export interface GestureHost {
	svg: () => SVGSVGElement | null
	viewport: () => Viewport
	/** выставить вид мгновенно (жест пользователя — отключает автоподгонку) */
	setViewport: (v: Viewport) => void
	node: (id: string) => SimNode | undefined
	/** начало/конец перетаскивания узла: «подогреть» симуляцию */
	dragHeat: (on: boolean) => void
	tap: (id: string) => void
	setDragging: (id: string | null) => void
	wake: () => void
}

type Mode =
	| { t: 'none' }
	| { t: 'pan'; start: Pt; vp: Viewport; moved: boolean }
	| { t: 'node'; id: string; start: Pt; moved: boolean }
	| { t: 'pinch'; dist: number; mid: Pt; vp: Viewport }

export interface Gestures {
	down: (e: PointerEvent) => void
	move: (e: PointerEvent) => void
	up: (e: PointerEvent) => void
	wheel: (e: WheelEvent) => void
}

export function createGestures(h: GestureHost): Gestures {
	const pts = new Map<number, Pt>()
	let mode: Mode = { t: 'none' }
	let rect: DOMRect | null = null

	const local = (e: { clientX: number; clientY: number }): Pt => {
		const r = rect ?? h.svg()?.getBoundingClientRect()
		return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: e.clientX, y: e.clientY }
	}
	const toWorld = (p: Pt): Pt => {
		const v = h.viewport()
		return { x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k }
	}
	const pinchState = (): { dist: number; mid: Pt } | null => {
		const [a, b] = [...pts.values()]
		if (!a || !b) return null
		return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
	}
	const releaseNode = (): void => {
		if (mode.t !== 'node') return
		const n = h.node(mode.id)
		if (n && n.id !== YOU) {
			n.fx = null
			n.fy = null
		}
		if (mode.moved) h.dragHeat(false)
		h.setDragging(null)
	}

	return {
		down(e) {
			if (e.button !== 0 && e.pointerType === 'mouse') return
			const svg = h.svg()
			if (!svg) return
			rect = svg.getBoundingClientRect()
			const p = local(e)
			pts.set(e.pointerId, p)
			try {
				svg.setPointerCapture(e.pointerId)
			} catch {
				/* указатель уже отпущен */
			}
			if (pts.size === 2) {
				releaseNode()
				const ps = pinchState()
				if (ps) mode = { t: 'pinch', ...ps, vp: h.viewport() }
				return
			}
			if (pts.size > 2) return
			const target = e.target instanceof Element ? e.target.closest<SVGElement>('[data-node]') : null
			const id = target?.dataset['node']
			mode = id ? { t: 'node', id, start: p, moved: false } : { t: 'pan', start: p, vp: h.viewport(), moved: false }
		},
		move(e) {
			if (!pts.has(e.pointerId)) return
			const p = local(e)
			pts.set(e.pointerId, p)
			if (mode.t === 'pinch') {
				const ps = pinchState()
				if (!ps || mode.dist < 1) return
				const k = clamp((mode.vp.k * ps.dist) / mode.dist, MIN_K, MAX_K)
				const z = zoomAt(mode.vp, mode.mid.x, mode.mid.y, k)
				h.setViewport({ k, x: z.x + ps.mid.x - mode.mid.x, y: z.y + ps.mid.y - mode.mid.y })
				return
			}
			if (mode.t === 'pan') {
				const dx = p.x - mode.start.x
				const dy = p.y - mode.start.y
				if (!mode.moved && Math.hypot(dx, dy) < TAP_SLOP) return
				mode.moved = true
				h.setViewport({ ...mode.vp, x: mode.vp.x + dx, y: mode.vp.y + dy })
				return
			}
			if (mode.t === 'node') {
				if (!mode.moved && Math.hypot(p.x - mode.start.x, p.y - mode.start.y) < TAP_SLOP) return
				if (mode.id === YOU) return
				const n = h.node(mode.id)
				if (!n) return
				if (!mode.moved) {
					mode.moved = true
					h.dragHeat(true)
					h.setDragging(mode.id)
				}
				const w = toWorld(p)
				n.fx = w.x
				n.fy = w.y
				h.wake()
			}
		},
		up(e) {
			if (!pts.has(e.pointerId)) return
			pts.delete(e.pointerId)
			if (mode.t === 'node' && !mode.moved && e.type === 'pointerup') h.tap(mode.id)
			if (mode.t === 'node') releaseNode()
			if (mode.t === 'pinch' && pts.size === 1) {
				// после щипка продолжаем панорамирование оставшимся пальцем
				const [rest] = [...pts.values()]
				mode = rest ? { t: 'pan', start: rest, vp: h.viewport(), moved: true } : { t: 'none' }
				return
			}
			if (pts.size === 0) {
				mode = { t: 'none' }
				rect = null
			}
		},
		wheel(e) {
			e.preventDefault()
			const r = h.svg()?.getBoundingClientRect()
			const p = r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: e.clientX, y: e.clientY }
			const v = h.viewport()
			// тачпад-щипок приходит как wheel + ctrlKey — он «быстрее»
			const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))
			const k = clamp(v.k * f, MIN_K, MAX_K)
			h.setViewport(zoomAt(v, p.x, p.y, k))
		},
	}
}
