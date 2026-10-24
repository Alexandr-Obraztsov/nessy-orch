/** Тела запросов и ответов REST API. */
import type { AgentView, Message, NodeId, RoleView, RuntimeId, SpaceView, SessionStatus, SessionView } from './domain'

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
	/** служебное имя агента (латиницей, коротко): занятое получает суффикс (-2, -3), настоящее имя — в `agent.name`; не задано — роль, роль-2, … */
	name?: string
	/** короткий понятный заголовок агента для списка и шапки (до 80 знаков); поручение (цель) — отдельно, в `prompt` */
	title?: string
	/** id или имя роли */
	role?: string
	/** рантайм агента (пространства); по умолчанию — рантайм выбранного пространства */
	runtime?: RuntimeId
	/** модель агента (пространства); не задана — дефолт рантайма/конфига */
	model?: string
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
	/** рантайм пространства; по умолчанию — nessy-sdk */
	runtime?: RuntimeId
	/** модель по умолчанию для агентов пространства */
	model?: string
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
	/**
	 * модель субагента: псевдоним или id (`opus`, `claude-sonnet-…`). Пустая строка или null — убрать; при правке без значения прежняя сохраняется
	 */
	model?: string | null
	/** рантайм субагента (подсказка выбора пространства); null — убрать; при правке без значения прежний сохраняется */
	runtime?: RuntimeId | null
	/** абсолютный путь к папке пакета роли (скрипты, шаблоны, команды…): оркестратор копирует её в свой каталог, `{{role_dir}}` в инструкциях заменяется путём копии */
	packageDir?: string
}

/** POST /agents/:ref/model — сменить модель живого агента (только свободного, если рантайм умеет `capabilities.setModel`). */
export interface ModelRequest {
	/** псевдоним или id модели */
	model: string
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

/** POST /sessions/attach — Claude начал (или продолжил) чат: сессия этого чата (есть — берём, нет — создаём) и переход вкладки к ней. */
export interface AttachRequest {
	/** id чата Claude (session_id хука SessionStart) */
	chatId: string
	/** каталог чата (cwd хука); без него — каталог прежней сессии */
	cwd?: string
	/** сессия, из которой пришёл вызов (`NESSY_ORCH_SESSION`): её `successor` указывает на результат */
	from?: string
}

export interface SessionPatch {
	title?: string
	status?: SessionStatus
	summary?: string | null
}

/** GET /agents/:ref/wait?timeout=СЕК — дождаться, пока агент освободится, и получить его последний ответ. */
export interface WaitResponse {
	/** агент свободен (ход и очередь закончены); false — время вышло, агент ещё работает */
	done: boolean
	agent: AgentView
	/** последний ответ агента (после ожидания); undefined — агент ещё ничего не отвечал */
	reply?: Message
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
