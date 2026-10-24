/** События чата агента и потоков (/stream, /agents/:id/stream, внутренняя шина). */
import type { AgentView, Message, NodeId, RoleView, SpaceView, SessionView, ToolStatus } from './domain'
import type { CaseView, ChatMessage, JobView, JournalEntry, LearningSettings, PlaybookView } from './learning'

interface EventBase {
	seq: number
	ts: number
}
export interface UserEvent extends EventBase {
	kind: 'user'
	from: NodeId
	msgId: string
	text: string
}
export interface TextEvent extends EventBase {
	kind: 'text' | 'thought'
	text: string
}
export interface ToolEvent extends EventBase {
	kind: 'tool'
	toolId: string
	name: string
	title: string
	input: Record<string, unknown>
	status: ToolStatus
	output?: string
	/** когда вызов завершился (completed/failed); длительность = endedTs − ts */
	endedTs?: number
}
export interface PermissionEvent extends EventBase {
	kind: 'permission'
	requestId: string
	title: string
	resolved: boolean
	approved?: boolean
	auto?: boolean
}
export interface SystemEvent extends EventBase {
	kind: 'system'
	level: 'info' | 'error'
	text: string
}
export type AgentEvent = UserEvent | TextEvent | ToolEvent | PermissionEvent | SystemEvent

export interface ChunkEvent {
	seq: number
	ts: number
	kind: 'text' | 'thought'
	delta: string
	len: number
}

/** Событие общего потока `/stream`. */
export type StreamEvent =
	| {
			t: 'snapshot'
			rev: number
			spaces: SpaceView[]
			agents: AgentView[]
			roles: RoleView[]
			sessions: SessionView[]
			messages: Message[]
	  }
	| { t: 'message'; rev: number; message: Message }
	| { t: 'agent'; rev: number; agent: AgentView }
	| { t: 'agent_removed'; rev: number; id: string }
	| { t: 'space'; rev: number; space: SpaceView }
	| { t: 'space_removed'; rev: number; name: string }
	| { t: 'role'; rev: number; role: RoleView }
	| { t: 'role_removed'; rev: number; id: string }
	| { t: 'session'; rev: number; session: SessionView }
	| { t: 'session_removed'; rev: number; id: string }
	| { t: 'learning_job'; rev: number; job: JobView }
	| { t: 'learning_case'; rev: number; case: CaseView }
	| { t: 'learning_case_removed'; rev: number; id: string }
	| { t: 'learning_settings'; rev: number; settings: LearningSettings }
	| { t: 'learning_playbook'; rev: number; playbook: PlaybookView }
	| { t: 'learning_playbook_removed'; rev: number; id: string }
	| { t: 'learning_journal'; rev: number; entry: JournalEntry }
	| { t: 'learning_chat'; rev: number; subject: string; message: ChatMessage }

/** Всё, что ходит по внутренней шине (включая события агентов). */
export type HubEvent =
	| Exclude<StreamEvent, { t: 'snapshot' }>
	| { t: 'event'; rev: number; agentId: string; event: AgentEvent }
	| { t: 'chunk'; rev: number; agentId: string; chunk: ChunkEvent }

/** Входные данные publish (rev выставляет шина). */
export type HubInput =
	| { t: 'message'; message: Message }
	| { t: 'agent'; agent: AgentView }
	| { t: 'agent_removed'; id: string }
	| { t: 'space'; space: SpaceView }
	| { t: 'space_removed'; name: string }
	| { t: 'role'; role: RoleView }
	| { t: 'role_removed'; id: string }
	| { t: 'session'; session: SessionView }
	| { t: 'session_removed'; id: string }
	| { t: 'learning_job'; job: JobView }
	| { t: 'learning_case'; case: CaseView }
	| { t: 'learning_case_removed'; id: string }
	| { t: 'learning_settings'; settings: LearningSettings }
	| { t: 'learning_playbook'; playbook: PlaybookView }
	| { t: 'learning_playbook_removed'; id: string }
	| { t: 'learning_journal'; entry: JournalEntry }
	| { t: 'learning_chat'; subject: string; message: ChatMessage }
	| { t: 'event'; agentId: string; event: AgentEvent }
	| { t: 'chunk'; agentId: string; chunk: ChunkEvent }

/** Событие потока одного агента `/agents/:id/stream`. */
export type AgentStreamEvent = { t: 'event'; event: AgentEvent } | { t: 'chunk'; chunk: ChunkEvent } | { t: 'agent'; agent: AgentView } | { t: 'replay_done' }
