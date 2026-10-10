/** Тела запросов и ответов REST API. */
import type { AgentView, Message, NodeId, RoleView, SpaceView, SessionStatus, SessionView } from './domain'

export interface GraphView {
	rev: number
	spaces: SpaceView[]
	agents: AgentView[]
	roles: RoleView[]
	sessions: SessionView[]
}

export interface SpawnRequest {
	/** имя пространства или путь к воркспейсу */
	space?: string
	name?: string
	/** id или имя роли */
	role?: string
	/** id сессии; по умолчанию — сессия родителя (агент, запущенный агентом, наследует её) */
	session?: string
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

/** POST /agents/:ref/plan — агент сообщает план целиком. */
export interface PlanRequest {
	/** id агента-автора (должен совпадать с :ref) */
	from?: string
	entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
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

/** POST /sessions — завести сессию; PATCH /sessions/:id — переименовать, закрыть, записать итог. */
export interface SessionRequest {
	title: string
	owner?: string
	/** slug; по умолчанию — из заголовка + короткий суффикс */
	id?: string
}

export interface SessionPatch {
	title?: string
	status?: SessionStatus
	summary?: string | null
}

/** GET /inbox?session=<id> — только ответы агентов этой сессии, со своим курсором на каждую сессию. */
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
