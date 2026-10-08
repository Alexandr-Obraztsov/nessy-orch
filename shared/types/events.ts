/** События чата агента и потоков (/stream, /agents/:id/stream, внутренняя шина). */
import type { AgentView, Message, NodeId, SpaceView, ToolStatus } from './domain'

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
	| { t: 'snapshot'; rev: number; spaces: SpaceView[]; agents: AgentView[]; messages: Message[] }
	| { t: 'message'; rev: number; message: Message }
	| { t: 'agent'; rev: number; agent: AgentView }
	| { t: 'agent_removed'; rev: number; id: string }
	| { t: 'space'; rev: number; space: SpaceView }
	| { t: 'space_removed'; rev: number; name: string }

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
	| { t: 'event'; agentId: string; event: AgentEvent }
	| { t: 'chunk'; agentId: string; chunk: ChunkEvent }

/** Событие потока одного агента `/agents/:id/stream`. */
export type AgentStreamEvent =
	| { t: 'event'; event: AgentEvent }
	| { t: 'chunk'; chunk: ChunkEvent }
	| { t: 'agent'; agent: AgentView }
	| { t: 'replay_done' }
