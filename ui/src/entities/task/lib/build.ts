/**
 * Поручения из плоского списка агентов: дерево по `parent`, заголовок, сводный статус, прогресс.
 * Чистые функции — без React и стора.
 */
import type { AgentView, Message } from '@contract'
import { agentState, planCount, type AgentState } from '@/entities/agent'
import type { Task, TaskAgent, TaskProgress, TaskStatus } from '../model/types'

const YOU = 'you'
const TITLE_MAX = 160

/** Заголовок из текста задачи: первая непустая строка без markdown-маркеров. */
export function titleFromText(text: string): string {
	for (const raw of text.split('\n')) {
		const line = raw
			.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
			.replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
			.trim()
		if (line) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
	}
	return ''
}

/** Первое сообщение каждому агенту: отдельно от вас и от кого угодно (ключ — id получателя). */
export function firstMessages(messages: Message[]): { fromYou: Map<string, Message>; any: Map<string, Message> } {
	const fromYou = new Map<string, Message>()
	const any = new Map<string, Message>()
	for (const m of messages) {
		if (m.kind !== 'msg') continue
		if (!any.has(m.to)) any.set(m.to, m)
		if (m.from === YOU && !fromYou.has(m.to)) fromYou.set(m.to, m)
	}
	return { fromYou, any }
}

/** Сводный статус поручения по состояниям его агентов. */
export function taskStatus(states: AgentState[]): TaskStatus {
	if (states.includes('wait')) return 'attention'
	if (states.includes('error')) return 'error'
	if (states.includes('working') || states.includes('starting')) return 'working'
	if (states.length > 0 && states.every(s => s === 'done')) return 'done'
	return 'paused'
}

/** Прогресс: план корневого агента, иначе «завершено агентов N из M» (если агентов больше одного). */
export function taskProgress(root: AgentView, agents: TaskAgent[]): TaskProgress | null {
	const plan = planCount(root)
	if (plan) return { ...plan, kind: 'plan' }
	if (agents.length > 1) return { done: agents.filter(a => a.state === 'done').length, total: agents.length, kind: 'agents' }
	return null
}

const time = (iso: string): number => {
	const t = Date.parse(iso)
	return Number.isNaN(t) ? 0 : t
}

/** Корень поручения: родитель — вы (или система), либо родителя уже нет среди агентов. */
export function isRoot(a: AgentView, ids: Set<string>): boolean {
	return a.parent === YOU || !ids.has(a.parent) || a.parent === a.id
}

/** Все поручения (без фильтров и сортировки). */
export function buildTasks(agents: AgentView[], messages: Message[]): Task[] {
	const ids = new Set(agents.map(a => a.id))
	const children = new Map<string, AgentView[]>()
	for (const a of agents) {
		if (isRoot(a, ids)) continue
		const list = children.get(a.parent) ?? []
		list.push(a)
		children.set(a.parent, list)
	}
	for (const list of children.values()) list.sort((x, y) => time(x.createdAt) - time(y.createdAt))

	const first = firstMessages(messages)
	const tasks: Task[] = []
	for (const root of agents) {
		if (!isRoot(root, ids)) continue
		const rows: TaskAgent[] = []
		const seen = new Set<string>()
		// обход в глубину; seen — защита от циклов в данных
		const walk = (a: AgentView, depth: number): void => {
			if (seen.has(a.id)) return
			seen.add(a.id)
			rows.push({ agent: a, state: agentState(a), depth, taskId: root.id })
			for (const c of children.get(a.id) ?? []) walk(c, depth + 1)
		}
		walk(root, 0)

		const status = taskStatus(rows.map(r => r.state))
		const lastActivityAt = Math.max(...rows.map(r => time(r.agent.lastActivityAt)), time(root.createdAt))
		const msg = first.fromYou.get(root.id) ?? first.any.get(root.id)
		const title = (msg && titleFromText(msg.text)) || root.displayName || root.name
		tasks.push({
			id: root.id,
			root,
			title,
			space: root.space,
			agents: rows,
			status,
			progress: taskProgress(root, rows),
			steps: rows.reduce((n, r) => n + r.agent.turnSteps, 0),
			startedAt: time(root.createdAt),
			endedAt: status === 'working' || status === 'attention' ? null : lastActivityAt,
			lastActivityAt,
			result: root.lastReply?.preview ?? null,
		})
	}
	return tasks
}

/** Длительность поручения, мс: до последнего события или до «сейчас», пока оно идёт. */
export function taskDuration(t: Pick<Task, 'startedAt' | 'endedAt'>, now: number): number {
	return Math.max(0, (t.endedAt ?? now) - t.startedAt)
}

/** Поручение, в которое входит агент. */
export function taskOfAgent(tasks: Task[], agentId: string): Task | undefined {
	return tasks.find(t => t.agents.some(r => r.agent.id === agentId))
}
