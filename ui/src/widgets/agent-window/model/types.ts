import type { AgentView, PermissionEvent, SystemEvent, TextEvent, ToolEvent, UserEvent } from '@contract'
import type { AgentState, AgentStreamState, LiveRun } from '@/entities/agent'

export interface AgentWindowProps {
	/** открытый агент или null (окно закрыто) */
	agentId: string | null
	onClose: () => void
}

export interface WindowBodyProps {
	agentId: string
	onClose: () => void
}

export interface WindowViewProps {
	agent: AgentView
	stream: AgentStreamState
	onClose: () => void
}

export interface HeaderProps {
	agent: AgentView
	state: AgentState
	onClose: () => void
}

export interface TranscriptProps {
	agent: AgentView
	stream: AgentStreamState
}

/** Элемент чата агента. brief — первое поручение (выделенный блок сверху). */
export type ChatItem =
	| { kind: 'brief'; key: string; ev: UserEvent }
	| { kind: 'user'; key: string; ev: UserEvent }
	| { kind: 'text'; key: string; ev: TextEvent }
	| { kind: 'thought'; key: string; ev: TextEvent }
	| { kind: 'tool'; key: string; ev: ToolEvent }
	| { kind: 'permission'; key: string; ev: PermissionEvent }
	| { kind: 'system'; key: string; ev: SystemEvent }
	| { kind: 'live'; key: string; run: LiveRun }

/** Что показать при раскрытии инструмента. */
export interface ToolDetail {
	/** вход: команда / diff / содержимое / JSON аргументов (null — нечего показывать) */
	input: { code: string; lang: string | null; label: string } | null
	output: { code: string; lang: string | null; label: string } | null
	/** краткий итог справа в строке («42 строки», «exit 1», «+3 −1») */
	summary: string
}

export interface ToolCallProps {
	ev: ToolEvent
}

export interface PermissionItemProps {
	agentId: string
	ev: PermissionEvent
	/** запрос всё ещё ждёт решения (есть в pendingPermissions агента) */
	pending: boolean
}

export interface BriefProps {
	text: string
}
