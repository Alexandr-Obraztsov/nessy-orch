import type { AgentView } from '@contract'
import type { AgentState } from '@/entities/agent'

/** Сводный статус поручения (по приоритету): ждёт вас → ошибка → в работе → пауза → готово. */
export type TaskStatus = 'attention' | 'error' | 'working' | 'paused' | 'done'

/** Агент внутри поручения. */
export interface TaskAgent {
	agent: AgentView
	state: AgentState
	/** глубина в дереве поручения: 0 — корневой агент */
	depth: number
	/** id поручения (= id корневого агента) */
	taskId: string
}

export interface TaskProgress {
	done: number
	total: number
	/** откуда знаменатель: план корневого агента или число агентов */
	kind: 'plan' | 'agents'
}

/** Поручение: корневой агент и все агенты, которых он породил. */
export interface Task {
	/** id корневого агента */
	id: string
	root: AgentView
	title: string
	space: string
	/** корень первым, дальше — дети в порядке обхода дерева */
	agents: TaskAgent[]
	status: TaskStatus
	progress: TaskProgress | null
	/** вызовов инструментов в текущих (последних) ходах всех агентов */
	steps: number
	/** мс: создание корневого агента */
	startedAt: number
	/** мс: последнее событие, если поручение не идёт (иначе null — таймер живой) */
	endedAt: number | null
	/** мс: последнее событие любого агента */
	lastActivityAt: number
	/** превью последнего ответа корневого агента */
	result: string | null
}

/** Группа в списке поручений: карточки поручений или плоские строки агентов. */
export type TaskGroup =
	| { kind: 'tasks'; key: string; label: string | null; collapsible: boolean; defaultOpen: boolean; tasks: Task[] }
	| { kind: 'agents'; key: string; label: string | null; rows: TaskAgent[] }

export interface TaskCounts {
	attention: number
	error: number
	working: number
	done: number
}
