/**
 * Силовая раскладка (d3-force): «Вы» закреплены в центре, агенты — на орбитах по глубине,
 * мягко стянуты к сектору своего пространства. Симуляция не держит свой таймер —
 * её «тикает» общий rAF-цикл графа.
 */
import { useCallback, useMemo, useRef } from 'react'
import {
	type Simulation,
	forceCollide,
	forceLink,
	forceManyBody,
	forceRadial,
	forceSimulation,
	forceX,
	forceY,
} from 'd3-force'
import { YOU } from '@/shared/model'
import { type Bounds, orbitRadius } from '../lib/geometry'
import type { EdgeDatum, NodeDatum, SectorDatum, SimLink, SimNode } from './types'

export const YOU_R = 24
export const AGENT_R = 15

export interface SimulationApi {
	sim: Simulation<SimNode, SimLink>
	/** текущие узлы симуляции по id */
	map: () => Map<string, SimNode>
	sync: (nodes: NodeDatum[], edges: EdgeDatum[], sectors: SectorDatum[]) => void
	bounds: () => Bounds
}

const rand = (s: number): number => (Math.random() - 0.5) * s

export function useSimulation(): SimulationApi {
	const sim = useMemo(
		() =>
			forceSimulation<SimNode, SimLink>()
				.stop()
				.alphaDecay(0.03)
				.velocityDecay(0.38),
		[],
	)
	const byIdRef = useRef(new Map<string, SimNode>())
	const sigRef = useRef('')
	const first = useRef(true)

	const sync = useCallback(
		(nodes: NodeDatum[], edges: EdgeDatum[], sectors: SectorDatum[]) => {
			const old = byIdRef.current
			const byId = new Map<string, SimNode>()
			const angle = new Map(sectors.map(s => [s.space, s.angle]))
			const multi = sectors.length > 1
			// сколько узлов на каждой орбите — чтобы раздвинуть тесные
			const crowd = new Map<number, number>()
			for (const n of nodes) if (!n.you) crowd.set(n.depth, (crowd.get(n.depth) ?? 0) + 1)
			const radius = (d: number): number => orbitRadius(d, crowd.get(d) ?? 1)

			// порядковый номер внутри пространства — для начальной расстановки веером
			const seq = new Map<string, number>()
			for (const n of nodes) {
				let s = old.get(n.id)
				if (!s) {
					const parent = n.parent ? (byId.get(n.parent) ?? old.get(n.parent)) : undefined
					if (n.you) s = { id: n.id, r: YOU_R, depth: 0, space: null, parent: null, x: 0, y: 0 }
					else if (parent && parent.id !== YOU && parent.x !== undefined && parent.y !== undefined) {
						s = { id: n.id, r: AGENT_R, depth: n.depth, space: n.space, parent: n.parent, x: parent.x + rand(60), y: parent.y + rand(60) }
					} else {
						const i = seq.get(n.space ?? '') ?? 0
						seq.set(n.space ?? '', i + 1)
						const base = (n.space ? angle.get(n.space) : undefined) ?? -Math.PI / 2
						const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.32 + rand(0.1)
						const r = radius(n.depth) * (0.8 + Math.random() * 0.2)
						s = { id: n.id, r: AGENT_R, depth: n.depth, space: n.space, parent: n.parent, x: Math.cos(a) * r, y: Math.sin(a) * r }
					}
				}
				s.depth = n.depth
				s.space = n.space
				s.parent = n.parent
				s.r = n.you ? YOU_R : AGENT_R
				if (n.you) {
					s.fx = 0
					s.fy = 0
				}
				byId.set(n.id, s)
			}
			byIdRef.current = byId

			const links: SimLink[] = edges
				.filter(e => byId.has(e.a) && byId.has(e.b))
				.map(e => ({ source: e.a, target: e.b, kind: e.kind }))

			const sx = (n: SimNode): number => {
				const a = n.space ? angle.get(n.space) : undefined
				return a === undefined ? 0 : Math.cos(a) * radius(n.depth)
			}
			const sy = (n: SimNode): number => {
				const a = n.space ? angle.get(n.space) : undefined
				return a === undefined ? 0 : Math.sin(a) * radius(n.depth)
			}
			const sectorK = (n: SimNode): number => (multi && n.id !== YOU ? (n.depth === 1 ? 0.07 : 0.025) : 0)

			sim.nodes([...byId.values()])
				.force(
					'link',
					forceLink<SimNode, SimLink>(links)
						.id(d => d.id)
						.distance(l => (l.kind === 'comm' ? 200 : (l.source as SimNode).id === YOU ? radius(1) : 95))
						.strength(l => (l.kind === 'comm' ? 0.012 : (l.source as SimNode).id === YOU ? 0.02 : 0.45)),
				)
				.force(
					'charge',
					forceManyBody<SimNode>()
						.strength(n => (n.id === YOU ? -500 : -240))
						.distanceMax(520),
				)
				.force(
					'collide',
					forceCollide<SimNode>(n => n.r + 28)
						.strength(0.9)
						.iterations(2),
				)
				.force(
					'radial',
					forceRadial<SimNode>(n => radius(Math.max(1, n.depth)), 0, 0).strength(n =>
						n.id === YOU ? 0 : n.depth === 1 ? 0.32 : 0.06,
					),
				)
				.force('sx', forceX<SimNode>(sx).strength(sectorK))
				.force('sy', forceY<SimNode>(sy).strength(sectorK))

			// подогреваем симуляцию только если изменилась структура
			const sig = `${[...byId.keys()].join(',')}#${links.length}#${sectors.map(s => s.space).join(',')}`
			if (sig !== sigRef.current) {
				const grownBy = byId.size - old.size
				sigRef.current = sig
				if (first.current && byId.size > 1) {
					// первая загрузка: сразу разложить, без «взрыва» на экране
					first.current = false
					sim.alpha(1)
					for (let i = 0; i < 160; i++) sim.tick()
					sim.alpha(0.08)
				} else {
					sim.alpha(Math.max(sim.alpha(), grownBy !== 0 ? 0.7 : 0.3))
				}
			}
		},
		[sim],
	)

	const bounds = useCallback((): Bounds => {
		const b = { x0: -170, y0: -170, x1: 170, y1: 170 }
		for (const n of byIdRef.current.values()) {
			const x = n.x ?? 0
			const y = n.y ?? 0
			b.x0 = Math.min(b.x0, x - n.r - 40)
			b.x1 = Math.max(b.x1, x + n.r + 40)
			b.y0 = Math.min(b.y0, y - n.r - 24)
			b.y1 = Math.max(b.y1, y + n.r + 46)
			// дуги и подписи секторов пространств лежат снаружи — продлеваем радиально
			const d = Math.hypot(x, y)
			if (n.space && d > 1) {
				const f = (d + 74) / d
				b.x0 = Math.min(b.x0, x * f)
				b.x1 = Math.max(b.x1, x * f)
				b.y0 = Math.min(b.y0, y * f)
				b.y1 = Math.max(b.y1, y * f)
			}
		}
		return b
	}, [])

	const map = useCallback(() => byIdRef.current, [])
	return useMemo(() => ({ sim, map, sync, bounds }), [sim, map, sync, bounds])
}
