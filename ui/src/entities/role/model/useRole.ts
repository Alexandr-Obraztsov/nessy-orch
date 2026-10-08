import type { AgentView, RoleView } from '@contract'
import { useStore } from '@/shared/model'

/** Роль по id (реактивно). */
export function useRole(id: string | null | undefined): RoleView | undefined {
	return useStore(s => (id ? s.roles.find(r => r.id === id) : undefined))
}

/** Агенты с данной ролью (в порядке стора). */
export function agentsWithRole(agents: AgentView[], id: string): AgentView[] {
	return agents.filter(a => a.role === id)
}
