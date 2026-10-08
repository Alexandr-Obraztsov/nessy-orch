/**
 * «Движок» графа: d3-force, вид (пан/зум) и жесты в одном rAF-цикле.
 * Координаты пишутся прямо в DOM-атрибуты — React перерисовывает граф только при смене данных.
 */
import { type RefCallback, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import { type Bounds, clamp, fitViewport, lerp, zoomAt } from '../lib/geometry'
import { MAX_K, MIN_K, createGestures } from './gestures'
import type { GEdge, GraphData, SimLink, SimNode, Size, Viewport } from './types'

const FIT_PAD = 40
const FIT_MAX_K = 1.6
/** с какого масштаба подписи видны всегда */
export const LABEL_K = 1.1

export interface GraphEngine {
	containerRef: RefCallback<HTMLDivElement>
	svgRef: RefCallback<SVGSVGElement>
	worldRef: RefCallback<SVGGElement>
	nodeRef: (id: string) => RefCallback<SVGGElement>
	edgeRef: (id: string) => RefCallback<SVGLineElement>
	size: Size
	dragging: string | null
	zoomBy: (f: number) => void
	fit: () => void
}

/** Кэш ref-колбэков по ключу — чтобы React не перевешивал ref на каждом рендере. */
function useRefRegistry<E extends Element>(onAttach: (key: string, el: E) => void) {
	const els = useRef(new Map<string, E>())
	const cbs = useRef(new Map<string, RefCallback<E>>())
	const attach = useRef(onAttach)
	attach.current = onAttach
	const get = useCallback((key: string): RefCallback<E> => {
		let cb = cbs.current.get(key)
		if (!cb) {
			cb = (el: E | null) => {
				if (el) {
					els.current.set(key, el)
					attach.current(key, el)
				} else {
					els.current.delete(key)
					cbs.current.delete(key)
				}
			}
			cbs.current.set(key, cb)
		}
		return cb
	}, [])
	return { els, get }
}

/** Позиции узлов переживают закрытие вкладки «Граф» — раскладка не прыгает при возврате. */
const positions = new Map<string, SimNode>()

const rand = (s: number): number => (Math.random() - 0.5) * s
const f1 = (n: number | undefined): string => (n ?? 0).toFixed(1)

export function useGraphEngine(data: GraphData, onTap: (id: string) => void): GraphEngine {
	const sim = useMemo(() => forceSimulation<SimNode, SimLink>().stop().alphaDecay(0.028).velocityDecay(0.4), [])
	const byId = useRef(new Map<string, SimNode>(positions))
	const edges = useRef(new Map<string, GEdge>())
	const sig = useRef('')
	const first = useRef(positions.size === 0)

	const svg = useRef<SVGSVGElement | null>(null)
	const world = useRef<SVGGElement | null>(null)
	const [size, setSize] = useState<Size>({ w: 0, h: 0 })
	const sizeRef = useRef(size)
	const [dragging, setDragging] = useState<string | null>(null)

	const vp = useRef<Viewport>({ x: 0, y: 0, k: 1 })
	const vpTarget = useRef<Viewport | null>(null)
	const follow = useRef(true)
	const tapRef = useRef(onTap)
	tapRef.current = onTap

	// ---------- запись в DOM ----------
	const writeNode = (id: string, el: SVGGElement): void => {
		const n = byId.current.get(id)
		if (n) el.setAttribute('transform', `translate(${f1(n.x)} ${f1(n.y)})`)
	}
	const writeEdge = (id: string, el: SVGLineElement): void => {
		const e = edges.current.get(id)
		const A = e && byId.current.get(e.a)
		const B = e && byId.current.get(e.b)
		if (!A || !B) return
		el.setAttribute('x1', f1(A.x))
		el.setAttribute('y1', f1(A.y))
		el.setAttribute('x2', f1(B.x))
		el.setAttribute('y2', f1(B.y))
	}
	const writeViewport = (): void => {
		const v = vp.current
		world.current?.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.k.toFixed(4)})`)
		const el = svg.current
		if (el) {
			el.style.setProperty('--k', v.k.toFixed(3))
			el.dataset['zoomed'] = v.k >= LABEL_K ? '1' : '0'
		}
	}
	const nodeReg = useRefRegistry<SVGGElement>(writeNode)
	const edgeReg = useRefRegistry<SVGLineElement>(writeEdge)
	const writeAll = (): void => {
		for (const [id, el] of nodeReg.els.current) writeNode(id, el)
		for (const [id, el] of edgeReg.els.current) writeEdge(id, el)
	}

	const bounds = (): Bounds => {
		const b = { x0: -80, y0: -80, x1: 80, y1: 80 }
		for (const n of byId.current.values()) {
			const x = n.x ?? 0
			const y = n.y ?? 0
			b.x0 = Math.min(b.x0, x - n.r - 30)
			b.x1 = Math.max(b.x1, x + n.r + 30)
			b.y0 = Math.min(b.y0, y - n.r - 12)
			b.y1 = Math.max(b.y1, y + n.r + 26)
		}
		return b
	}
	const fitTarget = (): Viewport | null => {
		const s = sizeRef.current
		if (!s.w || !s.h) return null
		return fitViewport(bounds(), s, FIT_PAD, MIN_K, FIT_MAX_K)
	}

	// ---------- кадр ----------
	const raf = useRef(0)
	const step = (): boolean => {
		const active = sim.alpha() > sim.alphaMin()
		if (active) {
			sim.tick()
			writeAll()
		}
		if (follow.current && active) {
			const t = fitTarget()
			if (t) vpTarget.current = t
		}
		let moving = false
		const t = vpTarget.current
		if (t) {
			const c = vp.current
			const next = { x: lerp(c.x, t.x, 0.16), y: lerp(c.y, t.y, 0.16), k: lerp(c.k, t.k, 0.16) }
			if (Math.abs(next.x - t.x) < 0.3 && Math.abs(next.y - t.y) < 0.3 && Math.abs(next.k - t.k) < 0.0005) {
				vp.current = t
				vpTarget.current = null
			} else {
				vp.current = next
				moving = true
			}
			writeViewport()
		}
		return active || moving
	}
	const stepRef = useRef(step)
	stepRef.current = step
	const wake = useCallback(() => {
		if (raf.current) return
		const loop = (): void => {
			raf.current = 0
			if (stepRef.current()) raf.current = requestAnimationFrame(loop)
		}
		raf.current = requestAnimationFrame(loop)
	}, [])
	useEffect(
		() => () => {
			cancelAnimationFrame(raf.current)
			raf.current = 0
		},
		[],
	)

	// ---------- синхронизация данных ----------
	useLayoutEffect(() => {
		const old = byId.current
		const next = new Map<string, SimNode>()
		for (const n of data.nodes) {
			let s = old.get(n.id)
			if (!s) {
				const e = data.edges.find(x => (x.b === n.id && next.has(x.a)) || (x.a === n.id && next.has(x.b)))
				const p = e ? next.get(e.a === n.id ? e.b : e.a) : undefined
				s = { id: n.id, r: n.r, x: (p?.x ?? 0) + rand(n.you ? 0 : 80), y: (p?.y ?? 0) + rand(n.you ? 0 : 80) }
			}
			s.r = n.r
			next.set(n.id, s)
		}
		byId.current = next
		positions.clear()
		for (const [k, v] of next) positions.set(k, v)
		edges.current = new Map(data.edges.map(e => [e.id, e]))
		const links: SimLink[] = data.edges.map(e => ({ source: e.a, target: e.b, kind: e.kind }))
		sim.nodes([...next.values()])
			.force(
				'link',
				forceLink<SimNode, SimLink>(links)
					.id(d => d.id)
					.distance(l => (l.kind === 'parent' ? 56 : 80))
					.strength(l => (l.kind === 'parent' ? 0.6 : 0.15)),
			)
			.force('charge', forceManyBody<SimNode>().strength(-160).distanceMax(380))
			.force('collide', forceCollide<SimNode>(n => n.r + 6).strength(0.8))
			.force('x', forceX<SimNode>(0).strength(0.05))
			.force('y', forceY<SimNode>(0).strength(0.05))

		const s = `${[...next.keys()].join(',')}#${data.edges.map(e => e.id).join(',')}`
		if (s !== sig.current) {
			const grew = next.size !== old.size
			sig.current = s
			if (first.current && next.size > 1) {
				// первая загрузка: раскладываем сразу, без «взрыва» на экране
				first.current = false
				sim.alpha(1)
				for (let i = 0; i < 200; i++) sim.tick()
				sim.alpha(0.05)
			} else sim.alpha(Math.max(sim.alpha(), grew ? 0.6 : 0.3))
		}
		writeAll()
		if (follow.current) {
			const t = fitTarget()
			if (t && vp.current.k === 1 && vp.current.x === 0 && vp.current.y === 0) {
				vp.current = t
				writeViewport()
			} else if (t) vpTarget.current = t
		}
		wake()
	}, [data, sim, wake])

	// ---------- размер ----------
	const ro = useRef<ResizeObserver | null>(null)
	const containerRef = useCallback((el: HTMLDivElement | null) => {
		ro.current?.disconnect()
		if (!el) return
		const obs = new ResizeObserver(([entry]) => {
			if (!entry) return
			const w = Math.round(entry.contentRect.width)
			const h = Math.round(entry.contentRect.height)
			const prev = sizeRef.current
			if (w === prev.w && h === prev.h) return
			sizeRef.current = { w, h }
			setSize({ w, h })
			if (follow.current || !prev.w) {
				const t = fitTarget()
				if (t) {
					vp.current = t
					vpTarget.current = null
				}
			} else vp.current = { ...vp.current, x: vp.current.x + (w - prev.w) / 2, y: vp.current.y + (h - prev.h) / 2 }
			writeViewport()
		})
		obs.observe(el)
		ro.current = obs
	}, [])

	// ---------- жесты ----------
	const gestures = useMemo(
		() =>
			createGestures({
				svg: () => svg.current,
				viewport: () => vp.current,
				setViewport: v => {
					follow.current = false
					vpTarget.current = null
					vp.current = v
					writeViewport()
				},
				node: id => byId.current.get(id),
				dragHeat: on => {
					sim.alphaTarget(on ? 0.2 : 0)
					if (on) sim.alpha(Math.max(sim.alpha(), 0.25))
					wake()
				},
				tap: id => tapRef.current(id),
				setDragging,
				wake,
			}),
		[sim, wake],
	)

	const svgRef = useCallback(
		(el: SVGSVGElement | null) => {
			const prev = svg.current
			if (prev) {
				prev.removeEventListener('pointerdown', gestures.down)
				prev.removeEventListener('pointermove', gestures.move)
				prev.removeEventListener('pointerup', gestures.up)
				prev.removeEventListener('pointercancel', gestures.up)
				prev.removeEventListener('wheel', gestures.wheel)
			}
			svg.current = el
			if (!el) return
			el.addEventListener('pointerdown', gestures.down)
			el.addEventListener('pointermove', gestures.move)
			el.addEventListener('pointerup', gestures.up)
			el.addEventListener('pointercancel', gestures.up)
			el.addEventListener('wheel', gestures.wheel, { passive: false })
			writeViewport()
		},
		[gestures],
	)

	const zoomBy = useCallback(
		(f: number) => {
			const s = sizeRef.current
			const base = vpTarget.current ?? vp.current
			follow.current = false
			vpTarget.current = zoomAt(base, s.w / 2, s.h / 2, clamp(base.k * f, MIN_K, MAX_K))
			wake()
		},
		[wake],
	)
	const fit = useCallback(() => {
		follow.current = true
		vpTarget.current = fitTarget()
		wake()
	}, [wake])

	return {
		containerRef,
		svgRef,
		worldRef: useCallback((el: SVGGElement | null) => {
			world.current = el
			if (el) writeViewport()
		}, []),
		nodeRef: nodeReg.get,
		edgeRef: edgeReg.get,
		size,
		dragging,
		zoomBy,
		fit,
	}
}
