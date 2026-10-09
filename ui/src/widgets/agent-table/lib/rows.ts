/**
 * Строки таблицы: группы «Работают» / «Выполнено», порядок и фильтр по чипам (чистые функции).
 * В «Работают» сверху то, что ждёт вас (разрешения), затем ошибки, затем остальные по времени запуска —
 * порядок стабилен, строки не прыгают от каждого события. В «Выполнено» — новые сверху.
 */
import type { AgentView, RoleView } from '@contract'
import { agentState, finishedAt, groupOf, type AgentState } from '@/entities/agent'
import type { StatusFilter } from '@/shared/model'
import type { AgentRowModel, TableGroup, Transitions } from '../model/types'

const RANK: Record<AgentState, number> = { wait: 0, error: 1, working: 2, starting: 2, idle: 2, done: 2 }

const created = (a: AgentView): number => {
	const t = Date.parse(a.createdAt)
	return Number.isNaN(t) ? 0 : t
}

export function matchesFilter(state: AgentState, filter: StatusFilter): boolean {
	switch (filter) {
		case 'all':
			return true
		case 'wait':
		case 'error':
		case 'done':
			return state === filter
		case 'working':
			return state === 'working' || state === 'starting' || state === 'idle'
	}
}

export function buildGroups(
	agents: AgentView[],
	ctx: { roles: RoleView[]; titles: Map<string, string>; filter: StatusFilter; tr: Transitions },
): TableGroup[] {
	const work: AgentRowModel[] = []
	const done: AgentRowModel[] = []
	for (const agent of agents) {
		const state = agentState(agent)
		if (!matchesFilter(state, ctx.filter)) continue
		const role = agent.role ? ctx.roles.find(r => r.id === agent.role) : undefined
		const group = ctx.tr.held.has(agent.id) && ctx.filter !== 'done' ? 'work' : groupOf(state)
		const row: AgentRowModel = {
			agent,
			state,
			group,
			task: ctx.titles.get(agent.id) ?? '—',
			role: role ? { name: role.name, hue: role.color } : null,
			fresh: ctx.tr.fresh.has(agent.id),
			flash: ctx.tr.flash.has(agent.id),
		}
		;(group === 'work' ? work : done).push(row)
	}
	work.sort((x, y) => RANK[x.state] - RANK[y.state] || created(x.agent) - created(y.agent))
	done.sort((x, y) => finishedAt(y.agent) - finishedAt(x.agent))
	return [
		{ key: 'work', rows: work },
		{ key: 'done', rows: done },
	]
}
