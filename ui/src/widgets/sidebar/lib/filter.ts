import type { AgentView, RoleView, SpaceView } from '@contract'
import type { SpaceFolder } from '../model/types'

const busy = (a: AgentView): boolean => a.status === 'working' || a.status === 'starting'

/** Все слова запроса встречаются в тексте. */
export function hit(hay: string, q: string): boolean {
	if (!q) return true
	const h = hay.toLowerCase()
	return q
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every(p => h.includes(p))
}

export const matchAgent = (a: AgentView, q: string, roleName = ''): boolean =>
	hit([a.name, a.id, a.space, a.displayName ?? '', a.preview, roleName].join('\n'), q)
export const matchRole = (r: RoleView, q: string): boolean => hit([r.name, r.id, r.description].join('\n'), q)
export const matchSpace = (s: SpaceView, q: string): boolean => hit([s.name, s.path].join('\n'), q)

/** Работающие — сверху, затем по последней активности. */
export function sortAgents(list: AgentView[]): AgentView[] {
	return list.slice().sort((a, b) => Number(busy(b)) - Number(busy(a)) || Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
}

/** Активные агенты по папкам пространств (в порядке пространств; неизвестные — в конце). */
export function foldersOf(agents: AgentView[], spaces: SpaceView[]): SpaceFolder[] {
	const by = new Map<string, AgentView[]>()
	for (const a of agents) by.set(a.space, [...(by.get(a.space) ?? []), a])
	const keys = [...spaces.map(s => s.name).filter(n => by.has(n)), ...[...by.keys()].filter(k => !spaces.some(s => s.name === k))]
	return keys.map(key => {
		const list = by.get(key) ?? []
		return { key, space: spaces.find(s => s.name === key) ?? null, agents: sortAgents(list), working: list.filter(busy).length }
	})
}
