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
	/** прервать текущий ход адресата (по умолчанию нет: сообщение уходит в идущий ход или в очередь) */
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
	/** заголовок; без него — имя каталога `cwd` (вкладка проекта приложения) */
	title?: string
	owner?: string
	/** slug; по умолчанию — из заголовка + короткий суффикс */
	id?: string
	/** каталог проекта (абсолютный путь): агенты сессии запускаются в нём */
	cwd?: string
	/** id чата Claude Code (uuid, `--session-id`): сессия = вкладка этого чата */
	chatId?: string
}

/** Отчёт хука Stop: главный агент закончил ход; `chatId` — актуальный id чата (меняется после /clear и /resume). */
export interface LeadReport {
	idle: boolean
	chatId?: string
}

/** Сводка непрочитанных Claude ответов и вопросов агентов (`GET /sessions/:id/digest`). */
export interface DigestResponse {
	/** строка-заголовок, которую приложение набирает клавишами перед вставкой тела */
	header: string
	/** тело для вставки (очищено от управляющих символов, ≤8 КБ); пусто — нечего доставлять */
	text: string
	/** курсор для `POST /sessions/:id/ack` — последнее реально вошедшее в text сообщение */
	cursor: number
	/** сколько сообщений вошло в text */
	count: number
	/** сколько не поместилось (придут следующей пачкой) */
	hidden: number
	/** имена агентов сессии, которые ещё работают */
	working: string[]
	/** у сессии сейчас висит фоновое ожидание (`inbox --session S --all`): второе запускать не нужно */
	watching?: boolean
}

/** Итог ожидания пачки (`GET /sessions/:id/wait`): почему вернулись и сводка. */
export interface SettledResponse {
	/** idle — все агенты закончили; question — агент задал вопрос; timeout — агенты ещё работают; nothing — ждать нечего */
	reason: 'idle' | 'question' | 'timeout' | 'nothing'
	digest: DigestResponse
	/** сколько агентов сессии ещё работает */
	active: number
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
	/** курсор после последнего из `replies`: его подтверждают `POST /sessions/:id/ack` после того, как ответы реально выведены */
	cursor: number
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
