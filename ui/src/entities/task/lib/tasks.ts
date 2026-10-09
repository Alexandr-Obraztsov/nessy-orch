/**
 * Задачи («ящики» оркестраторов): порядок в сайдбаре, агенты колонки, сводка по агентам.
 * Чистые функции — без React и стора.
 */
import type { AgentView, TaskView } from '@contract'
import type { TaskStats } from './tasks.types'

const ALL = '@all'
const NONE = '@none'

const ts = (iso: string): number => {
	const t = Date.parse(iso)
	return Number.isNaN(t) ? 0 : t
}

/** id задачи агента (старый сервер поля task не присылает — тогда «без задачи»). */
export function taskOf(a: AgentView): string | null {
	const v: unknown = (a as { task?: unknown }).task
	return typeof v === 'string' && v ? v : null
}

/** Активные — сверху, по свежести; завершённые — отдельно, тоже по свежести. */
export function splitTasks(tasks: TaskView[]): { active: TaskView[]; done: TaskView[] } {
	const byFresh = [...tasks].sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt) || a.id.localeCompare(b.id))
	return { active: byFresh.filter(t => t.status === 'active'), done: byFresh.filter(t => t.status === 'done') }
}

/** Агенты колонки: задачи, «Все агенты» (@all) или «Без задачи» (@none). */
export function agentsOf(agents: AgentView[], column: string): AgentView[] {
	if (column === ALL) return agents
	if (column === NONE) return agents.filter(a => taskOf(a) === null)
	return agents.filter(a => taskOf(a) === column)
}

export function taskStats(agents: AgentView[]): TaskStats {
	const st: TaskStats = { total: agents.length, working: 0, waiting: 0, error: 0 }
	for (const a of agents) {
		if (a.pendingPermissions.length > 0) st.waiting++
		else if (a.status === 'error') st.error++
		else if (a.status === 'working' || a.status === 'starting') st.working++
	}
	return st
}
