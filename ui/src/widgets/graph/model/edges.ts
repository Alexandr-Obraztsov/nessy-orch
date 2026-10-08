/**
 * Рёбра графа: parent-связи и агрегаты переписки между парами узлов.
 */
import type { AgentView, Message } from '@contract'
import { YOU } from '@/shared/model'
import type { EdgeDatum } from './types'

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Переписку показываем для обычных сообщений и ответов, без событий и системы. */
export function isCommMessage(m: Message): boolean {
	return m.kind !== 'event' && m.from !== 'system' && m.to !== 'system' && m.from !== m.to
}

export function parentEdges(agents: AgentView[], ids: Set<string>): EdgeDatum[] {
	const out: EdgeDatum[] = []
	for (const a of agents) {
		const p = a.parent && ids.has(a.parent) ? a.parent : YOU
		out.push({ id: `p:${a.id}`, kind: 'parent', a: p, b: a.id, count: 0, lastTs: 0, lastFailed: false })
	}
	return out
}

export function commEdges(messages: Message[], ids: Set<string>): EdgeDatum[] {
	const map = new Map<string, EdgeDatum>()
	for (const m of messages) {
		if (!isCommMessage(m) || !ids.has(m.from) || !ids.has(m.to)) continue
		const key = pairKey(m.from, m.to)
		let e = map.get(key)
		if (!e) {
			const [a, b] = m.from < m.to ? [m.from, m.to] : [m.to, m.from]
			e = { id: `c:${key}`, kind: 'comm', a, b, count: 0, lastTs: 0, lastFailed: false }
			map.set(key, e)
		}
		e.count++
		if (m.ts >= e.lastTs) {
			e.lastTs = m.ts
			e.lastFailed = Boolean(m.failed)
		}
	}
	return [...map.values()]
}
