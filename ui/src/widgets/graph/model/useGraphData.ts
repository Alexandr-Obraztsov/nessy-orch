/**
 * Данные графа из стора: узлы (Вы + агенты, с «призраками» удалённых для анимации ухода),
 * рёбра (parent + переписка) и секторы пространств.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentView } from '@contract'
import { YOU, spaceHue, useStore } from '@/shared/model'
import { sectorAngles } from '../lib/geometry'
import { commEdges, parentEdges } from './edges'
import type { EdgeDatum, NodeDatum, SectorDatum } from './types'

const LEAVE_MS = 420

export interface GraphData {
	nodes: NodeDatum[]
	edges: EdgeDatum[]
	sectors: SectorDatum[]
}

function depthOf(a: AgentView, byId: Map<string, AgentView>): number {
	let d = 1
	let p = a.parent
	const seen = new Set<string>([a.id])
	while (p && p !== YOU && !seen.has(p)) {
		const next = byId.get(p)
		if (!next) break
		seen.add(p)
		d++
		p = next.parent
	}
	return d
}

export function useGraphData(): GraphData {
	const agents = useStore(s => s.agents)
	const spaces = useStore(s => s.spaces)
	const messages = useStore(s => s.messages)

	const live = useMemo<NodeDatum[]>(() => {
		const byId = new Map(agents.map(a => [a.id, a]))
		const you: NodeDatum = {
			id: YOU,
			you: true,
			name: 'Вы',
			space: null,
			hue: 160,
			status: null,
			parent: null,
			depth: 0,
			queued: 0,
			perms: 0,
			leaving: false,
		}
		return [
			you,
			...agents.map<NodeDatum>(a => ({
				id: a.id,
				you: false,
				name: a.name,
				space: a.space,
				hue: spaceHue(spaces, a.space),
				status: a.status,
				parent: a.parent && byId.has(a.parent) ? a.parent : YOU,
				depth: depthOf(a, byId),
				queued: a.queued,
				perms: a.pendingPermissions.length,
				leaving: false,
			})),
		]
	}, [agents, spaces])

	// «призраки»: удалённые узлы доигрывают анимацию исчезновения
	const [ghosts, setGhosts] = useState<NodeDatum[]>([])
	const prev = useRef<NodeDatum[]>([])
	const timers = useRef(new Set<number>())
	useLayoutEffect(() => {
		const ids = new Set(live.map(n => n.id))
		const gone = prev.current.filter(n => !ids.has(n.id))
		prev.current = live
		setGhosts(g => {
			const kept = g.filter(n => !ids.has(n.id))
			return gone.length || kept.length !== g.length ? [...kept, ...gone.map(n => ({ ...n, leaving: true }))] : g
		})
		if (!gone.length) return
		const goneIds = new Set(gone.map(n => n.id))
		const t = window.setTimeout(() => {
			timers.current.delete(t)
			setGhosts(g => g.filter(n => !goneIds.has(n.id)))
		}, LEAVE_MS)
		timers.current.add(t)
	}, [live])
	useLayoutEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), [])

	const nodes = useMemo(() => (ghosts.length ? [...live, ...ghosts] : live), [live, ghosts])

	const edges = useMemo(() => {
		const ids = new Set(live.map(n => n.id))
		return [...parentEdges(agents, ids), ...commEdges(messages, ids)]
	}, [agents, messages, live])

	const sectors = useMemo<SectorDatum[]>(() => {
		// секторы только для пространств, где есть агенты (в порядке списка пространств)
		const used = new Set(agents.map(a => a.space))
		const names = [...spaces.map(s => s.name).filter(n => used.has(n)), ...[...used].filter(n => !spaces.some(s => s.name === n))]
		const ang = sectorAngles(names)
		return names.map(n => ({ space: n, hue: spaceHue(spaces, n), angle: ang.get(n) ?? 0 }))
	}, [agents, spaces])

	return { nodes, edges, sectors }
}
