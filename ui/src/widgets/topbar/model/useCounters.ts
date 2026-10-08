import { useMemo } from 'react'
import { useStore } from '@/shared/model'
import type { Counters } from './types'

/** Живые счётчики агентов для верхней панели. */
export function useCounters(): Counters {
	const agents = useStore(s => s.agents)
	return useMemo(() => {
		let dead = 0
		let working = 0
		let permissions = 0
		let firstPermissionAgent: string | null = null
		for (const a of agents) {
			if (a.status === 'dead') dead++
			if (a.status === 'working' || a.status === 'starting') working++
			if (a.pendingPermissions.length) {
				permissions += a.pendingPermissions.length
				firstPermissionAgent ??= a.id
			}
		}
		return { active: agents.length - dead, total: agents.length, dead, working, permissions, firstPermissionAgent }
	}, [agents])
}
