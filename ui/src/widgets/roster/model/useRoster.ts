import { useMemo, useState } from 'react'
import { useStore, useView } from '@/shared/model'
import { groupAgents } from '../lib/group'
import { useCollapsed } from './useCollapsed'

/** Данные ростера: группы с учётом поиска, свёрнутость, выбранный агент. */
export function useRoster() {
	const agents = useStore(s => s.agents)
	const spaces = useStore(s => s.spaces)
	const selected = useView(v => v.selectedAgentId)
	const [query, setQuery] = useState('')
	const [collapsed, toggle] = useCollapsed()
	const groups = useMemo(() => groupAgents(agents, spaces, query), [agents, spaces, query])
	const shown = groups.reduce((n, g) => n + g.alive.length + g.dead.length, 0)
	return { agents, spaces, groups, selected, query, setQuery, collapsed, toggle, shown }
}
