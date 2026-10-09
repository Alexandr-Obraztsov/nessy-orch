import type { AgentView } from '@contract'

export interface MiniCardProps {
	agent: AgentView
	/** поручение агента одной строкой */
	brief: string
	/** порядковый номер в списке — задержка появления (stagger) */
	index: number
	onOpen: (agent: AgentView) => void
}

/** Чип-фильтр поповера: «Все» или активная задача. */
export interface TaskChip {
	id: string
	label: string
	/** агентов в задаче ждут разрешения / работают */
	waiting: number
	working: number
}
