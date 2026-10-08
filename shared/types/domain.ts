/** Доменные сущности: узлы графа, пространства, агенты, сообщения ленты. */

/** Идентификатор узла графа: `you` либо id агента. */
export type NodeId = string

export type AgentStatus = 'starting' | 'idle' | 'working' | 'error' | 'dead' | 'sleeping'
export type SpaceStatus = 'stopped' | 'starting' | 'ready' | 'failed'
export type MessageKind = 'msg' | 'reply' | 'event'
/** Статус вызова инструмента — ровно эти четыре значения. */
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface SpaceView {
	name: string
	path: string
	/** hue 0..360 */
	color: number
	mode: 'managed' | 'external'
	url: string | null
	status: SpaceStatus
	error: string | null
}

export interface ToolBrief {
	name: string
	title: string
}

export interface PermissionBrief {
	requestId: string
	title: string
}

export interface AgentView {
	id: string
	name: string
	space: string
	parent: NodeId
	status: AgentStatus
	error: string | null
	displayName: string | null
	createdAt: string
	lastActivityAt: string
	queued: number
	turnStartedAt: string | null
	lastTool: ToolBrief | null
	preview: string
	pendingPermissions: PermissionBrief[]
}

/** Единица общей ленты («группчат»). */
export interface Message {
	/** монотонный номер для курсоров */
	seq: number
	id: string
	ts: number
	from: NodeId
	to: NodeId
	kind: MessageKind
	text: string
	/** длина цепочки агент→агент (защита от зацикливания) */
	hops: number
	/** id сообщения, на которое это ответ */
	replyTo?: string
	/** отправитель ждёт ответ синхронно (--wait): ответ не дублируется ему промптом */
	wait?: boolean
	/** сообщение не доставлено (причина) */
	failed?: string
}
