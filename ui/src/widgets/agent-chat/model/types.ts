import type { AgentEvent, AgentView, PermissionEvent, ToolEvent } from '@contract'
import type { LiveRun } from '@/entities/agent'

export interface AgentChatProps {
	agentId: string
}

export type ChatRow =
	| { t: 'day'; key: string; label: string }
	| { t: 'event'; key: string; ev: AgentEvent }
	| { t: 'live'; key: string; run: LiveRun }

export interface ChatHeaderProps {
	agent: AgentView
}

export interface ChatEventRowProps {
	ev: AgentEvent
	agent: AgentView
	enter: boolean
	/** длительность вызова инструмента, мс (если известна) */
	toolMs?: number
}

export interface ToolRowProps {
	ev: ToolEvent
	enter: boolean
	durationMs?: number
}

export interface ThoughtRowProps {
	text: string
	enter: boolean
}

export interface PermissionRowProps {
	ev: PermissionEvent
	agent: AgentView
	enter: boolean
}

export interface PendingPermissionsProps {
	agent: AgentView
	/** запросы, уже показанные в ленте событий */
	shown: Set<string>
}

/** Подпись и цвет роли для бейджа в шапке. */
export interface RoleBadgeView {
	label: string
	/** hue или null — роль удалена */
	hue: number | null
}
