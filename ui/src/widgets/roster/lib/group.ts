import type { AgentView, SpaceView } from '@contract'
import type { RosterGroup } from '../model/types'

const busy = (a: AgentView): boolean => a.status === 'working' || a.status === 'starting'

/** Работающие (и запускающиеся) — сверху, затем по последней активности. */
export function sortAgents(list: AgentView[]): AgentView[] {
	return list.slice().sort((a, b) => {
		const w = Number(busy(b)) - Number(busy(a))
		if (w) return w
		return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
	})
}

/** Совпадение с поиском: имя, id, описание, превью, инструмент, пространство. */
export function matches(a: AgentView, q: string): boolean {
	if (!q) return true
	const hay = [a.name, a.id, a.displayName ?? '', a.preview, a.lastTool?.title ?? '', a.space].join('\n').toLowerCase()
	return q
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every(part => hay.includes(part))
}

/** Группы по пространствам (в порядке пространств; «осиротевшие» — в конце). */
export function groupAgents(agents: AgentView[], spaces: SpaceView[], query: string): RosterGroup[] {
	const q = query.trim()
	const bySpace = new Map<string, AgentView[]>()
	for (const a of agents) {
		const list = bySpace.get(a.space)
		if (list) list.push(a)
		else bySpace.set(a.space, [a])
	}
	const keys = [...spaces.map(s => s.name), ...[...bySpace.keys()].filter(k => !spaces.some(s => s.name === k))]
	const groups: RosterGroup[] = []
	for (const key of keys) {
		const space = spaces.find(s => s.name === key) ?? null
		const all = bySpace.get(key) ?? []
		const found = all.filter(a => matches(a, q))
		// при поиске прячем группы без совпадений (если не совпало само имя пространства)
		if (q && !found.length && !key.toLowerCase().includes(q.toLowerCase())) continue
		groups.push({
			key,
			space,
			hue: space?.color ?? 170,
			alive: sortAgents(found.filter(a => a.status !== 'dead')),
			dead: sortAgents(found.filter(a => a.status === 'dead')),
			working: all.filter(busy).length,
			total: all.length,
		})
	}
	return groups
}
