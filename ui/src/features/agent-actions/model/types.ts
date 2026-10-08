import type { AgentView } from '@contract'

export interface AgentActionsProps {
	agent: AgentView
}

export interface ConfirmDeleteProps {
	agent: AgentView
	open: boolean
	onClose: () => void
}
