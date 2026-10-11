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
	/** каталог вызывающего (CLI передаёт свой cwd): пространство, если `space` не указан и пространств не одно */
	cwd?: string
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

/** POST /agents/batch — запустить несколько агентов за один вызов; общие поля применяются к каждому, у агента могут быть свои. */
export interface SpawnBatchRequest {
	space?: string
	cwd?: string
	session?: string
	from?: NodeId
	agents: SpawnRequest[]
}

/** Результат одного агента пакета: создан (`agent`) либо ошибка (`error`, `code`) — остальные агенты запускаются независимо. */
export type SpawnBatchItem = { ok: true; agent: AgentView; message?: Message } | { ok: false; error: string; code: string; name?: string }

export interface SpawnBatchResponse {
	results: SpawnBatchItem[]
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
	/** адресат был свободен — сообщение запустило его в работу */
	started?: boolean
	/** адресат работал — его ход прерван сообщением (или сообщение встало в очередь, см. queued) */
	interrupted?: boolean
	/** адресат работал — сообщение ждёт в его очереди */
	queued?: boolean
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
	/** имя иконки SF Symbols (`[a-z0-9.-]`, до 40 символов); пусто — без иконки; при правке без значения сохраняется прежняя */
	icon?: string
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
	/** сколько агентов сессии (без `session` — всех) ещё работают или ждут в очереди; 0 и нет сообщений — ждать нечего */
	active: number
}

/** Краткая сводка агента для хуков Claude Code. */
export interface AgentBrief {
	id: string
	name: string
	role: string | null
	status: 'starting' | 'working' | 'idle' | 'error'
	archived: boolean
	/** последняя команда/инструмент */
	lastTool: string | null
	/** шаги плана: выполнено / всего (null — плана нет) */
	plan: { done: number; total: number } | null
}

/** GET /sessions/:id/updates — что нового для Claude: агенты сессии и новые ответы (курсор общий с inbox сессии). */
export interface SessionUpdates {
	agents: AgentBrief[]
	replies: Message[]
	/** у сессии сейчас висит фоновое ожидание ответов (`inbox --session … --wait`) */
	watching: boolean
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
