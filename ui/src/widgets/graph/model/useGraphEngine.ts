/**
 * «Движок» графа: связывает симуляцию, вид (пан/зум), жесты и пакеты в один rAF-цикл.
 * Координаты пишутся прямо в DOM-атрибуты зарегистрированных элементов — React
 * перерисовывает граф только при изменении данных, а не на каждом тике.
 */
import { type RefCallback, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { YOU, closeAgent, onMessage, openAgent } from '@/shared/model'
import {
	arcPath,
	fitViewport,
	lerp,
	linePath,
	quadControl,
	quadPath,
	wrapAngle,
	zoomAt,
	clamp,
} from '../lib/geometry'
import { MAX_K, MIN_K, createGestures } from './gestures'
import { type PacketClasses, createPacketLayer } from './packets'
import type { GraphData } from './useGraphData'
import { useSimulation } from './useSimulation'
import type { EdgeDatum, SectorDatum, Size, Viewport } from './types'

const FIT_PAD = 28
const FIT_MAX_K = 1.25
const FIT_TOP = 36

export interface GraphEngine {
	containerRef: RefCallback<HTMLDivElement>
	svgRef: RefCallback<SVGSVGElement>
	worldRef: RefCallback<SVGGElement>
	packetsRef: RefCallback<SVGGElement>
	tooltipRef: RefCallback<HTMLDivElement>
	nodeRef: (id: string) => RefCallback<SVGGElement>
	edgeRef: (id: string) => RefCallback<SVGGElement>
	sectorRef: (space: string) => RefCallback<SVGGElement>
	size: Size
	hover: string | null
	setHover: (id: string | null) => void
	dragging: string | null
	zoomBy: (f: number) => void
	fit: () => void
	/** вид следует за графом автоматически (пока пользователь не двигал вид) */
	follow: boolean
}

export interface EngineOptions {
	data: GraphData
	packetClasses: PacketClasses
	/** анимировать пакеты (выключается при prefers-reduced-motion) */
	motion: boolean
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

export function useGraphEngine({ data, packetClasses, motion }: EngineOptions): GraphEngine {
	const sim = useSimulation()
	const container = useRef<HTMLDivElement | null>(null)
	const svg = useRef<SVGSVGElement | null>(null)
	const world = useRef<SVGGElement | null>(null)
	const packetsLayer = useRef<SVGGElement | null>(null)
	const tooltip = useRef<HTMLDivElement | null>(null)

	const [size, setSize] = useState<Size>({ w: 0, h: 0 })
	const sizeRef = useRef(size)
	const [hover, setHoverState] = useState<string | null>(null)
	const hoverRef = useRef<string | null>(null)
	const [dragging, setDragging] = useState<string | null>(null)
	const [follow, setFollow] = useState(true)

	const vp = useRef<Viewport>({ x: 0, y: 0, k: 1 })
	const vpTarget = useRef<Viewport | null>(null)
	const followRef = useRef(true)
	const dirty = useRef(true)

	const edges = useRef(new Map<string, EdgeDatum>())
	const sectors = useRef<SectorDatum[]>([])

	// ---------- запись координат в DOM ----------
	const writeNode = (id: string, el: SVGGElement): void => {
		const n = sim.map().get(id)
		if (n) el.setAttribute('transform', `translate(${(n.x ?? 0).toFixed(1)} ${(n.y ?? 0).toFixed(1)})`)
	}
	const writeEdge = (id: string, el: SVGGElement): void => {
		const e = edges.current.get(id)
		const nodes = sim.map()
		const A = e && nodes.get(e.a)
		const B = e && nodes.get(e.b)
		if (!e || !A || !B) return
		const a = { x: A.x ?? 0, y: A.y ?? 0 }
		const b = { x: B.x ?? 0, y: B.y ?? 0 }
		const d = e.kind === 'comm' ? quadPath(a, quadControl(a, b), b) : linePath(a, b)
		for (const p of el.querySelectorAll('path')) p.setAttribute('d', d)
	}
	const writeSector = (space: string, el: SVGGElement): void => {
		const s = sectors.current.find(x => x.space === space)
		if (!s) return
		let lo = Infinity
		let hi = -Infinity
		let rMax = 0
		for (const n of sim.map().values()) {
			if (n.space !== space) continue
			const x = n.x ?? 0
			const y = n.y ?? 0
			const a = wrapAngle(Math.atan2(y, x) - s.angle)
			lo = Math.min(lo, a)
			hi = Math.max(hi, a)
			rMax = Math.max(rMax, Math.hypot(x, y))
		}
		if (!Number.isFinite(lo)) return
		const r = rMax + 52
		const pad = 38 / r
		let a0 = s.angle + lo - pad
		let a1 = s.angle + hi + pad
		// минимальная и максимальная ширина дуги
		const minSpan = 0.5
		if (a1 - a0 < minSpan) {
			const m = (a0 + a1) / 2
			a0 = m - minSpan / 2
			a1 = m + minSpan / 2
		}
		if (a1 - a0 > Math.PI * 1.8) {
			const m = (a0 + a1) / 2
			a0 = m - Math.PI * 0.9
			a1 = m + Math.PI * 0.9
		}
		const [band, line, label] = el.querySelectorAll('path')
		band?.setAttribute('d', arcPath(r - 14, a0, a1))
		line?.setAttribute('d', arcPath(r, a0, a1))
		// подпись по дуге; в нижней половине — в обратную сторону, чтобы не была вверх ногами
		const mid = wrapAngle((a0 + a1) / 2)
		const lr = r + 6
		const half = Math.min((a1 - a0) / 2, 1.2)
		if (mid > 0 && mid < Math.PI) {
			const p0 = { x: Math.cos(mid + half) * (lr + 9), y: Math.sin(mid + half) * (lr + 9) }
			const p1 = { x: Math.cos(mid - half) * (lr + 9), y: Math.sin(mid - half) * (lr + 9) }
			const rr = (lr + 9).toFixed(1)
			label?.setAttribute('d', `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)}A${rr} ${rr} 0 0 0 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`)
		} else {
			label?.setAttribute('d', arcPath(lr, mid - half, mid + half))
		}
	}
	const writeViewport = (): void => {
		const v = vp.current
		world.current?.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.k.toFixed(4)})`)
		svg.current?.style.setProperty('--k', v.k.toFixed(3))
	}
	const writeTooltip = (): void => {
		const el = tooltip.current
		const id = hoverRef.current
		const n = id ? sim.map().get(id) : undefined
		if (!el || !n) return
		const v = vp.current
		const { w } = sizeRef.current
		const sx = (n.x ?? 0) * v.k + v.x
		const sy = (n.y ?? 0) * v.k + v.y
		const below = sy < 190
		const x = clamp(sx, 140, Math.max(140, w - 140))
		const y = below ? sy + (n.r + 30) * v.k : sy - (n.r + 10) * v.k
		el.dataset['place'] = below ? 'below' : 'above'
		el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
	}

	const nodeReg = useRefRegistry<SVGGElement>(writeNode)
	const edgeReg = useRefRegistry<SVGGElement>(writeEdge)
	const sectorReg = useRefRegistry<SVGGElement>(writeSector)

	const writeAll = (): void => {
		for (const [id, el] of nodeReg.els.current) writeNode(id, el)
		for (const [id, el] of edgeReg.els.current) writeEdge(id, el)
		for (const [s, el] of sectorReg.els.current) writeSector(s, el)
	}

	const fitTarget = (): Viewport | null => {
		const s = sizeRef.current
		if (!s.w || !s.h) return null
		// сверху — место под чипы сводки
		// на узких экранах чипы сводки переносятся в два ряда
		const top = s.w < 1100 ? FIT_TOP * 2 : FIT_TOP
		const v = fitViewport(sim.bounds(), { w: s.w, h: s.h - top }, FIT_PAD, MIN_K, FIT_MAX_K)
		return { ...v, y: v.y + top }
	}

	// ---------- пакеты ----------
	const packets = useMemo(
		() => createPacketLayer(() => packetsLayer.current, sim.map, packetClasses),
		[sim],
	)

	// ---------- кадр ----------
	const raf = useRef(0)
	const step = (now: number): boolean => {
		const s = sim.sim
		const simActive = s.alpha() > s.alphaMin()
		if (simActive) s.tick()
		if (simActive || dirty.current) {
			writeAll()
			dirty.current = false
		}
		if (followRef.current && (simActive || !vpTarget.current)) {
			const t = fitTarget()
			if (t) vpTarget.current = t
		}
		let vpActive = false
		const t = vpTarget.current
		if (t) {
			const c = vp.current
			const next = { x: lerp(c.x, t.x, 0.14), y: lerp(c.y, t.y, 0.14), k: lerp(c.k, t.k, 0.14) }
			if (Math.abs(next.x - t.x) < 0.3 && Math.abs(next.y - t.y) < 0.3 && Math.abs(next.k - t.k) < 0.0005) {
				vp.current = t
				vpTarget.current = null
			} else {
				vp.current = next
				vpActive = true
			}
			writeViewport()
		}
		const pk = packets.step(now)
		writeTooltip()
		return simActive || vpActive || pk
	}
	const stepRef = useRef(step)
	stepRef.current = step
	const wake = useCallback(() => {
		if (raf.current) return
		const loop = (): void => {
			raf.current = 0
			if (stepRef.current(performance.now())) raf.current = requestAnimationFrame(loop)
		}
		raf.current = requestAnimationFrame(loop)
	}, [])
	useEffect(
		() => () => {
			// StrictMode «размонтирует» эффекты — сбрасываем, иначе wake() больше не запустит цикл
			cancelAnimationFrame(raf.current)
			raf.current = 0
		},
		[],
	)

	// ---------- синхронизация данных ----------
	useLayoutEffect(() => {
		edges.current = new Map(data.edges.map(e => [e.id, e]))
		sectors.current = data.sectors
		sim.sync(data.nodes, data.edges, data.sectors)
		writeAll()
		if (followRef.current) {
			const t = fitTarget()
			// первый показ — сразу на месте, дальше — плавно
			if (t && vp.current.k === 1 && vp.current.x === 0 && vp.current.y === 0) {
				vp.current = t
				writeViewport()
			} else if (t) vpTarget.current = t
		}
		wake()
	}, [data, sim, wake])

	// ---------- размер контейнера ----------
	const roRef = useRef<ResizeObserver | null>(null)
	const containerRef = useCallback(
		(el: HTMLDivElement | null) => {
			roRef.current?.disconnect()
			container.current = el
			if (!el) return
			const ro = new ResizeObserver(([entry]) => {
				if (!entry) return
				const w = Math.round(entry.contentRect.width)
				const h = Math.round(entry.contentRect.height)
				const prev = sizeRef.current
				if (w === prev.w && h === prev.h) return
				sizeRef.current = { w, h }
				setSize({ w, h })
				if (followRef.current || !prev.w) {
					const t = fitTarget()
					if (t) {
						vp.current = t
						vpTarget.current = null
					}
				} else {
					// держим центр вида на месте
					vp.current = { ...vp.current, x: vp.current.x + (w - prev.w) / 2, y: vp.current.y + (h - prev.h) / 2 }
				}
				writeViewport()
				writeTooltip()
			})
			ro.observe(el)
			roRef.current = ro
		},
		[],
	)

	// ---------- жесты ----------
	const setManual = useCallback((v: Viewport) => {
		followRef.current = false
		setFollow(false)
		vpTarget.current = null
		vp.current = v
	}, [])
	const gestures = useMemo(
		() =>
			createGestures({
				svg: () => svg.current,
				viewport: () => vp.current,
				setViewport: v => {
					setManual(v)
					writeViewport()
					writeTooltip()
				},
				node: id => sim.map().get(id),
				dragHeat: on => {
					sim.sim.alphaTarget(on ? 0.25 : 0)
					if (on) sim.sim.alpha(Math.max(sim.sim.alpha(), 0.3))
					wake()
				},
				tap: id => (id === YOU ? closeAgent() : openAgent(id)),
				setDragging,
				wake,
			}),
		[sim, wake, setManual],
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
			// колесо — не пассивный слушатель, чтобы не прокручивать страницу
			el.addEventListener('wheel', gestures.wheel, { passive: false })
			writeViewport()
		},
		[gestures],
	)

	// ---------- пакеты сообщений ----------
	const motionRef = useRef(motion)
	motionRef.current = motion
	useEffect(
		() =>
			onMessage(m => {
				if (!motionRef.current || document.hidden) return
				// стор уже обновлён, но React ещё не перерисовал рёбра — пакет стартует сразу
				if (packets.push(m)) wake()
			}),
		[packets, wake],
	)
	useEffect(() => () => packets.clear(), [packets])

	// ---------- API для UI ----------
	const setHover = useCallback((id: string | null) => {
		hoverRef.current = id
		setHoverState(id)
	}, [])
	useLayoutEffect(writeTooltip)

	const zoomBy = useCallback(
		(f: number) => {
			const s = sizeRef.current
			const base = vpTarget.current ?? vp.current
			const k = clamp(base.k * f, MIN_K, MAX_K)
			followRef.current = false
			setFollow(false)
			vpTarget.current = zoomAt(base, s.w / 2, s.h / 2, k)
			wake()
		},
		[wake],
	)
	const fit = useCallback(() => {
		followRef.current = true
		setFollow(true)
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
		packetsRef: useCallback((el: SVGGElement | null) => {
			packetsLayer.current = el
		}, []),
		tooltipRef: useCallback((el: HTMLDivElement | null) => {
			tooltip.current = el
			if (el) writeTooltip()
		}, []),
		nodeRef: nodeReg.get,
		edgeRef: edgeReg.get,
		sectorRef: sectorReg.get,
		size,
		hover,
		setHover,
		dragging,
		zoomBy,
		fit,
		follow,
	}
}
