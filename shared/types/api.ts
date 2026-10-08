/** Тела запросов и ответов REST API. */
import type { AgentView, Message, NodeId, RoleView, SpaceView } from './domain'

export interface GraphView {
	rev: number
	spaces: SpaceView[]
	agents: AgentView[]
	roles: RoleView[]
}

export interface SpawnRequest {
	/** имя пространства или путь к воркспейсу */
	space?: string
	name?: string
	/** id или имя роли */
	role?: string
	prompt?: string
	parent?: NodeId
	from?: NodeId
	wait?: boolean
	waitTimeoutSec?: number
}

export interface SendRequest {
	from?: NodeId
	text: string
	/**
	 * Прервать текущий ход агента и доставить сообщение сразу (вне очереди).
	 * По умолчанию true для сообщений от you, false — для сообщений агент→агент.
	 */
	interrupt?: boolean
	wait?: boolean
	waitTimeoutSec?: number
}

export interface SendResponse {
	message: Message
	/** при wait=true: ответ агента */
	reply?: Message
	timedOut?: boolean
}

export interface SpawnResponse extends SendResponse {
	agent: AgentView
}

export interface SpaceRequest {
	/** абсолютный путь воркспейса */
	path: string
	name?: string
	/** URL уже запущенного nessy serve (иначе оркестратор запустит свой) */
	url?: string
}

export interface RoleRequest {
	name: string
	description?: string
	instructions: string
	/** hue 0..360; по умолчанию — из имени */
	color?: number
	/** slug; по умолчанию — из имени (только при создании) */
	id?: string
}

export interface InboxResponse {
	messages: Message[]
	cursor: number
}

export interface StatusResponse {
	version: string
	pid: number
	uptimeSec: number
	rev: number
	home: string
	autoApprove: boolean
	spaces: number
	agents: number
	working: number
	roles: number
}

export interface ApiError {
	error: string
	code: string
}
