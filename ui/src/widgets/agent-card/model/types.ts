import type { AgentView } from '@contract'

export interface AgentCardProps {
	agent: AgentView
	/** поручение агента (первое сообщение ему), уже без разметки */
	brief: string
	/** заголовок задачи агента — строка под шапкой в «Все агенты» (null — без задачи); undefined — строки нет */
	taskTitle?: string | null
	/** порядковый номер в сетке — задержка появления (stagger) */
	index?: number
	onOpen: (id: string) => void
}
