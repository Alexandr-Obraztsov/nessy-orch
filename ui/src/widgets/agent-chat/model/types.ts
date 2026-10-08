import type { AgentEvent, AgentView } from '@contract'
import type { LiveRun } from '@/entities/agent'

export interface AgentChatProps {
	agentId: string
}

export type ChatRow =
	| { t: 'day'; key: string; label: string }
	/** first — первое событие подряд идущей серии с той же стороны (для «хвостика») */
	| { t: 'event'; key: string; ev: AgentEvent; first: boolean }
	| { t: 'live'; key: string; run: LiveRun; first: boolean }

export interface ChatHeaderProps {
	agent: AgentView
}
