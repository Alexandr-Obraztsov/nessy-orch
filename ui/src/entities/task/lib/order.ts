/**
 * Фильтр, поиск, сортировка и группировка поручений (чистые функции).
 */
import type { RoleView, SpaceView } from '@contract'
import type { Grouping, StatusFilter } from '@/shared/model'
import type { Task, TaskAgent, TaskCounts, TaskGroup, TaskStatus } from '../model/types'

const ORDER: Record<TaskStatus, number> = { attention: 0, error: 1, working: 2, paused: 3, done: 4 }
const STATE_ORDER = { wait: 0, error: 1, working: 2, starting: 3, idle: 4, done: 5 } as const

/** Ждёт вас → ошибка → в работе (свежие сверху) → пауза → готово (недавние сверху). */
export function compareTasks(a: Task, b: Task): number {
	const d = ORDER[a.status] - ORDER[b.status]
	if (d) return d
	if (a.status === 'working') return b.startedAt - a.startedAt
	return b.lastActivityAt - a.lastActivityAt
}

export function sortTasks(tasks: Task[]): Task[] {
	return tasks.slice().sort(compareTasks)
}

export function matchesFilter(t: Task, f: StatusFilter): boolean {
	return f === 'all' || t.status === f
}

/** Поиск по заголовку, пространству, агентам, ролям, текущему действию и тексту результатов. */
export function matchesSearch(t: Task, query: string, roles: RoleView[]): boolean {
	const q = query.trim().toLowerCase()
	if (!q) return true
	const parts: string[] = [t.title, t.space]
	for (const { agent: a } of t.agents) {
		parts.push(a.name, a.displayName ?? '', a.lastReply?.preview ?? '', a.lastTool?.title ?? '', a.preview, a.error ?? '')
		const role = a.role ? roles.find(r => r.id === a.role) : undefined
		if (role) parts.push(role.name)
	}
	return parts.join('\n').toLowerCase().includes(q)
}

export function filterTasks(tasks: Task[], filter: StatusFilter, query: string, roles: RoleView[]): Task[] {
	return tasks.filter(t => matchesFilter(t, filter) && matchesSearch(t, query, roles))
}

/** Счётчики сводки (по всем поручениям, без фильтра). */
export function countTasks(tasks: Task[]): TaskCounts {
	const c: TaskCounts = { attention: 0, error: 0, working: 0, done: 0 }
	for (const t of tasks) if (t.status !== 'paused') c[t.status]++
	return c
}

const isToday = (ts: number, now: number): boolean => new Date(ts).toDateString() === new Date(now).toDateString()

/** Строки агентов поручений (для группировки по ролям и плоского списка), важные сверху. */
export function agentRows(tasks: Task[]): TaskAgent[] {
	const rows = tasks.flatMap(t => t.agents)
	return rows.sort(
		(a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || Date.parse(b.agent.lastActivityAt) - Date.parse(a.agent.lastActivityAt),
	)
}

/**
 * Группы списка. По поручениям: активные карточки, затем «Завершённые сегодня» (раскрыта)
 * и «Завершённые ранее» (свёрнута). По пространствам — карточки, по ролям и плоский — строки агентов.
 */
export function groupTasks(tasks: Task[], grouping: Grouping, ctx: { spaces: SpaceView[]; roles: RoleView[]; now: number }): TaskGroup[] {
	const sorted = sortTasks(tasks)
	switch (grouping) {
		case 'tasks': {
			const active = sorted.filter(t => t.status !== 'done')
			const done = sorted.filter(t => t.status === 'done')
			const today = done.filter(t => isToday(t.lastActivityAt, ctx.now))
			const earlier = done.filter(t => !isToday(t.lastActivityAt, ctx.now))
			const groups: TaskGroup[] = [{ kind: 'tasks', key: 'active', label: null, collapsible: false, defaultOpen: true, tasks: active }]
			if (today.length)
				groups.push({ kind: 'tasks', key: 'group:done-today', label: 'Завершённые сегодня', collapsible: true, defaultOpen: true, tasks: today })
			if (earlier.length)
				groups.push({ kind: 'tasks', key: 'group:done-earlier', label: 'Завершённые ранее', collapsible: true, defaultOpen: false, tasks: earlier })
			return groups
		}
		case 'spaces': {
			const order = new Map(ctx.spaces.map((s, i) => [s.name, i]))
			const by = new Map<string, Task[]>()
			for (const t of sorted) by.set(t.space, [...(by.get(t.space) ?? []), t])
			return [...by.entries()]
				.sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b))
				.map(([space, list]) => ({ kind: 'tasks', key: `space:${space}`, label: space, collapsible: true, defaultOpen: true, tasks: list }))
		}
		case 'roles': {
			const by = new Map<string, TaskAgent[]>()
			for (const r of agentRows(sorted)) {
				const name = (r.agent.role && ctx.roles.find(x => x.id === r.agent.role)?.name) || 'Без роли'
				by.set(name, [...(by.get(name) ?? []), r])
			}
			return [...by.entries()]
				.sort(([a], [b]) => (a === 'Без роли' ? 1 : b === 'Без роли' ? -1 : a.localeCompare(b, 'ru')))
				.map(([name, rows]) => ({ kind: 'agents', key: `role:${name}`, label: name, rows }))
		}
		case 'flat':
			return [{ kind: 'agents', key: 'flat', label: null, rows: agentRows(sorted) }]
	}
}

/** Раскрыта ли группа/карточка: состояние по умолчанию, инвертированное отметкой в `collapsed`. */
export function isOpen(key: string, defaultOpen: boolean, toggled: string[]): boolean {
	return toggled.includes(key) ? !defaultOpen : defaultOpen
}
