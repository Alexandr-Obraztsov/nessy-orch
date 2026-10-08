/**
 * Данные графа из стора: «Вы» + агенты (архивные — по настройке), рёбра parent и переписки.
 */
import { useMemo } from 'react'
import type { Message } from '@contract'
import { YOU, useStore } from '@/shared/model'
import { nodeRadius } from '../lib/geometry'
import type { GEdge, GNode, GraphData } from './types'

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Переписка — обычные сообщения и ответы, без событий и системы. */
const isComm = (m: Message): boolean => m.kind !== 'event' && m.from !== 'system' && m.to !== 'system' && m.from !== m.to

export function useGraphData(showArchived: boolean): GraphData {
	const agents = useStore(s => s.agents)
	const roles = useStore(s => s.roles)
	const messages = useStore(s => s.messages)

	// счётчики сообщений и пары переписки
	const comm = useMemo(() => {
		const weight = new Map<string, number>()
		const pairs = new Set<string>()
		for (const m of messages) {
			if (!isComm(m)) continue
			weight.set(m.from, (weight.get(m.from) ?? 0) + 1)
			weight.set(m.to, (weight.get(m.to) ?? 0) + 1)
			pairs.add(pairKey(m.from, m.to))
		}
		return { weight, pairs }
	}, [messages])

	return useMemo<GraphData>(() => {
		const visible = agents.filter(a => showArchived || !a.archived)
		const ids = new Set([YOU, ...visible.map(a => a.id)])
		const hue = new Map(roles.map(r => [r.id, r.color]))
		const nodes: GNode[] = [
			{ id: YOU, name: 'Вы', you: true, roleHue: null, working: false, error: false, archived: false, weight: 0, r: 8 },
			...visible.map<GNode>(a => {
				const w = comm.weight.get(a.id) ?? 0
				return {
					id: a.id,
					name: a.name,
					you: false,
					roleHue: a.role ? (hue.get(a.role) ?? null) : null,
					working: a.status === 'working' || a.status === 'starting',
					error: a.status === 'error',
					archived: a.archived,
					weight: w,
					r: nodeRadius(w),
				}
			}),
		]
		const edges = new Map<string, GEdge>()
		for (const a of visible) {
			// родитель скрыт (в архиве) или удалён — связываем с «Вы»
			const p = a.parent && ids.has(a.parent) ? a.parent : YOU
			const key = pairKey(p, a.id)
			edges.set(key, { id: key, kind: 'parent', a: p, b: a.id })
		}
		for (const key of comm.pairs) {
			if (edges.has(key)) continue
			const [a, b] = key.split('|')
			if (a && b && ids.has(a) && ids.has(b)) edges.set(key, { id: key, kind: 'comm', a, b })
		}
		return { nodes, edges: [...edges.values()], archived: agents.filter(a => a.archived).length }
	}, [agents, roles, comm, showArchived])
}
