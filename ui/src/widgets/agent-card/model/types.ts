import type { AgentView } from '@contract'

export interface AgentCardProps {
	agent: AgentView
	/** поручение агента (первое сообщение ему), уже без разметки */
	brief: string
	/** заголовок задачи агента — показывается в «Все агенты» */
	taskTitle?: string | null
	onOpen: (id: string) => void
}
