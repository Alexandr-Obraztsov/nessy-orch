/** Доменные сущности: узлы графа, пространства, агенты, сообщения ленты. */

/** Идентификатор узла графа: `you` либо id агента. */
export type NodeId = string

/**
 * Статус агента. Состояния сна нет: агент без работы — idle; закончив задачу, он уходит в архив
 * (archived=true), а его сессия nessy сохраняется и восстанавливается при следующем сообщении.
 * error — последний ход завершился ошибкой (или упала сессия); следующее сообщение начинает заново.
 */
export type AgentStatus = 'starting' | 'working' | 'idle' | 'error'
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
	/** id роли (RoleView.id) или null */
	role: string | null
	status: AgentStatus
	/**
	 * Скрыт из рабочего списка: задача выполнена. Сессия сохранена — сообщение агенту
	 * (или POST /agents/:ref/restore) возвращает его в работу с прежним контекстом.
	 */
	archived: boolean
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

/** Роль субагента: сохранённые инструкции, которые добавляются в контекст агента при создании. */
export interface RoleView {
	/** slug, уникален: латиница, цифры, дефис */
	id: string
	name: string
	/** одна строка: для чего роль */
	description: string
	/** инструкции агенту (markdown) — попадают во вводную агента */
	instructions: string
	/** hue 0..360 для метки роли */
	color: number
	createdAt: string
	updatedAt: string
}
