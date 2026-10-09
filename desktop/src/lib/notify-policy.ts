/**
 * Когда показывать уведомления. Трекер держит последнее состояние агентов из `/stream` и
 * сравнивает каждое обновление с предыдущим:
 * - новый запрос разрешения → `permission` (один раз на requestId);
 * - запрос решён где-то ещё → `permission_resolved` (закрыть уведомление);
 * - агент ушёл в архив после успешного хода → `done`;
 * - агент перешёл в `error` → `error`.
 * Снапшот (старт и каждое переподключение) только запоминает состояние — без уведомлений.
 */
import type { AgentView, StreamEvent, TaskView } from '../../../shared/types'
import type { NotificationSpec, NotifyIntent } from '../types'

/** Сколько ключей дедупликации помнить. */
const SEEN_LIMIT = 2000

export class AgentTracker {
	private readonly agents = new Map<string, AgentView>()
	private readonly tasks = new Map<string, TaskView>()
	private readonly seen = new Set<string>()
	private synced = false

	/** Принять событие потока; вернуть, о чём уведомить. */
	apply(evt: StreamEvent): NotifyIntent[] {
		switch (evt.t) {
			case 'snapshot':
				return this.snapshot(evt.agents, evt.tasks)
			case 'agent':
				return this.update(evt.agent)
			case 'agent_removed': {
				const prev = this.agents.get(evt.id)
				this.agents.delete(evt.id)
				return prev ? prev.pendingPermissions.map(p => ({ kind: 'permission_resolved' as const, agentId: prev.id, requestId: p.requestId })) : []
			}
			case 'task':
				this.tasks.set(evt.task.id, evt.task)
				return []
			case 'task_removed':
				this.tasks.delete(evt.id)
				return []
			default:
				return []
		}
	}

	/** Соединение потеряно: следующий снапшот снова будет базой без уведомлений. */
	disconnect(): void {
		this.synced = false
	}

	get isSynced(): boolean {
		return this.synced
	}

	agent(id: string): AgentView | undefined {
		return this.agents.get(id)
	}

	task(id: string | null): TaskView | undefined {
		return id === null ? undefined : this.tasks.get(id)
	}

	list(): AgentView[] {
		return [...this.agents.values()]
	}

	private snapshot(agents: AgentView[], tasks: TaskView[]): NotifyIntent[] {
		const before = new Map(this.agents)
		this.agents.clear()
		this.tasks.clear()
		for (const t of tasks) this.tasks.set(t.id, t)
		const out: NotifyIntent[] = []
		const live = new Set<string>()
		for (const a of agents) {
			this.agents.set(a.id, a)
			// всё, что уже есть в снапшоте, считаем показанным
			for (const p of a.pendingPermissions) {
				this.mark(permKey(a.id, p.requestId))
				live.add(permKey(a.id, p.requestId))
			}
			if (a.status === 'error') this.mark(errorKey(a))
			if (a.archived) this.mark(doneKey(a))
		}
		// запросы, которые решились, пока не было связи, — убрать их уведомления
		for (const prev of before.values())
			for (const p of prev.pendingPermissions)
				if (!live.has(permKey(prev.id, p.requestId))) out.push({ kind: 'permission_resolved', agentId: prev.id, requestId: p.requestId })
		this.synced = true
		return out
	}

	private update(a: AgentView): NotifyIntent[] {
		const prev = this.agents.get(a.id)
		this.agents.set(a.id, a)
		if (!this.synced) return []
		const out: NotifyIntent[] = []
		const now = new Set(a.pendingPermissions.map(p => p.requestId))
		for (const p of a.pendingPermissions)
			if (this.mark(permKey(a.id, p.requestId))) out.push({ kind: 'permission', agentId: a.id, requestId: p.requestId, title: p.title })
		for (const p of prev?.pendingPermissions ?? [])
			if (!now.has(p.requestId)) out.push({ kind: 'permission_resolved', agentId: a.id, requestId: p.requestId })

		const becameError = a.status === 'error' && prev?.status !== 'error'
		if (becameError && this.mark(errorKey(a))) out.push({ kind: 'error', agentId: a.id, error: a.error ?? 'сессия завершилась ошибкой' })

		const becameArchived = a.archived && prev !== undefined && !prev.archived && a.status !== 'error'
		if (becameArchived && this.mark(doneKey(a))) out.push({ kind: 'done', agentId: a.id })
		return out
	}

	/** Запомнить ключ; true — увидели впервые. */
	private mark(key: string): boolean {
		if (this.seen.has(key)) return false
		this.seen.add(key)
		if (this.seen.size > SEEN_LIMIT) {
			const first = this.seen.values().next()
			if (!first.done) this.seen.delete(first.value)
		}
		return true
	}
}

const permKey = (agentId: string, requestId: string): string => `perm:${agentId}:${requestId}`
// ход идентифицируем по его началу: один ход — одно уведомление
const turnMark = (a: AgentView): string => a.turnStartedAt ?? a.lastActivityAt
const errorKey = (a: AgentView): string => `error:${a.id}:${turnMark(a)}`
const doneKey = (a: AgentView): string => `done:${a.id}:${turnMark(a)}`

/** Первая непустая строка текста без markdown-шелухи, не длиннее max. */
export function firstLine(text: string, max = 140): string {
	for (const raw of text.split(/\r?\n/)) {
		const line = raw
			.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, '')
			.replace(/[*_`~]+/g, '')
			.trim()
		if (line) return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
	}
	return ''
}

const agentName = (a: AgentView | undefined, fallback: string): string => a?.displayName ?? a?.name ?? fallback

/** query главного окна, открытого на агенте. */
export function agentQuery(agentId: string, task: string | null | undefined): string {
	const q = new URLSearchParams()
	if (task) q.set('task', task)
	q.set('agent', agentId)
	return '?' + q.toString()
}

/** Собрать текст уведомления. Агент берётся свежий — на момент показа. */
export function describe(intent: Exclude<NotifyIntent, { kind: 'permission_resolved' }>, agent: AgentView | undefined, task: TaskView | undefined): NotificationSpec {
	const name = agentName(agent, intent.agentId)
	const subtitle = task ? task.title : (agent?.space ?? '')
	const query = agentQuery(intent.agentId, agent?.task)
	switch (intent.kind) {
		case 'permission':
			return {
				id: permKey(intent.agentId, intent.requestId),
				title: `${name} просит разрешение`,
				subtitle,
				body: firstLine(intent.title, 180) || 'Нужно подтверждение действия',
				query,
				permission: { agentId: intent.agentId, requestId: intent.requestId },
			}
		case 'done': {
			const text = agent?.lastReply && !agent.lastReply.failed ? agent.lastReply.preview : (agent?.preview ?? '')
			return {
				id: `done:${intent.agentId}:${agent ? turnMark(agent) : ''}`,
				title: `${name} закончил`,
				subtitle,
				body: firstLine(text) || 'Задача выполнена',
				query,
				permission: null,
			}
		}
		case 'error':
			return {
				id: `error:${intent.agentId}:${agent ? turnMark(agent) : ''}`,
				title: `${name} упал`,
				subtitle,
				body: firstLine(intent.error) || 'Сессия завершилась ошибкой',
				query,
				permission: null,
			}
	}
}

/** Разобрать JSON кадра `/stream` (минимальная проверка формы — сервер наш). */
export function parseStreamEvent(data: string): StreamEvent | null {
	let raw: unknown
	try {
		raw = JSON.parse(data)
	} catch {
		return null
	}
	if (typeof raw !== 'object' || raw === null) return null
	const obj = raw as Record<string, unknown>
	const t = obj['t']
	if (typeof t !== 'string') return null
	const has = (k: string): boolean => typeof obj[k] === 'object' && obj[k] !== null
	if (t === 'snapshot' && !(has('agents') && has('tasks'))) return null
	if (t === 'agent' && !has('agent')) return null
	if (t === 'task' && !has('task')) return null
	// форма проверена по ключевым полям; остальное гарантирует контракт shared/types
	return raw as StreamEvent
}
