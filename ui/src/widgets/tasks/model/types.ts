import type { Task, TaskAgent } from '@/entities/task'

export interface AgentRowProps {
	row: TaskAgent
	selected: boolean
	/** в плоских группировках — без отступа дерева */
	flat?: boolean
}

export interface TaskCardProps {
	task: Task
	open: boolean
	selectedId: string | null
}
