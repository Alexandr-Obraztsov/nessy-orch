/** Доменные сущности: узлы графа, пространства, агенты, сообщения ленты. */

/** Идентификатор узла графа: `you` либо id агента. */
export type NodeId = string

/**
 * Статус агента. Состояния сна нет: агент без работы — idle; закончив сессию, он уходит в архив
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

/**
 * Сессия («ящик») — единица работы одного оркестратора (сессии Claude). Каждый Claude заводит свою
 * сессию и запускает агентов в ней; несколько Claude работают параллельно, не мешая друг другу:
 * у каждой сессии свой inbox. UI показывает сессии по отдельности или рядом.
 */
export type SessionStatus = 'active' | 'done'

/** Токены сессии nessy; поля, которых nessy не сообщил, равны 0. */
export interface TokenUsage {
	input: number
	output: number
	/** прочитано из кэша промпта */
	cached: number
	total: number
}

/** Счётчики работы агента: считает оркестратор, токены — по данным nessy (null — nessy их не сообщает). */
export interface AgentStats {
	/** завершённых ходов */
	turns: number
	/** вызовов инструментов за все ходы */
	toolCalls: number
	/** суммарная длительность ходов, мс */
	workMs: number
	tokens: TokenUsage | null
}

/** Источник, которым пользовались агенты сессии: ссылка из ответа/инструмента или ссылка на код/команда. */
export interface SourceView {
	id: string
	kind: 'url' | 'text'
	label: string
	/** только у kind=url */
	href?: string
	host?: string
	agentId: string
	agentName: string
	/** где встретился: в итоговом ответе агента или в вызове инструмента */
	origin: 'reply' | 'tool'
	ts: number
}

export interface SessionView {
	/** slug: латиница, цифры, дефис (например `fix-ci-3f2a`) */
	id: string
	title: string
	/** кто ведёт сессию: свободная метка оркестратора (например `claude`, имя окна) или null */
	owner: string | null
	status: SessionStatus
	/** итог сессии от оркестратора (session done --summary), markdown */
	summary: string | null
	createdAt: string
	updatedAt: string
	/** сколько источников собрано за сессию (список — GET /sessions/:id/sources) */
	sources: number
}

export interface AgentView {
	id: string
	name: string
	space: string
	/** id сессии (SessionView.id) или null — агент вне сессий */
	session: string | null
	parent: NodeId
	/** id роли (RoleView.id) или null */
	role: string | null
	status: AgentStatus
	/**
	 * Скрыт из рабочего списка: сессия выполнена. Сессия сохранена — сообщение агенту
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
	/** план агента (сообщил сам через `nessy-orch plan` или ACP `plan`); null — плана нет */
	plan: AgentPlan | null
	/** число вызовов инструментов в текущем (или последнем) ходе */
	turnSteps: number
	/** длительность последнего завершённого хода, мс (null — ходов ещё не было) */
	lastTurnMs: number | null
	/** последний ответ агента оператору (you) */
	lastReply: ReplyBrief | null
	stats: AgentStats
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

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanEntry {
	content: string
	status: PlanStatus
}

/** План целиком; каждое обновление заменяет его полностью (как ACP `plan`). */
export interface AgentPlan {
	entries: PlanEntry[]
	updatedAt: string
	/** откуда пришёл: от агента через CLI или из протокола nessy */
	source: 'cli' | 'acp'
}

/** Итог ответа агента по общему формату: строка «Статус: …» в конце. */
export type ReplyStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'BLOCKED' | 'NEEDS_CONTEXT'

export interface ReplyBrief {
	msgId: string
	ts: number
	/** причина, если ход завершился ошибкой */
	failed?: string
	/** первые ~200 символов ответа */
	preview: string
	/** статус из последней строки ответа («Статус: DONE …»); нет — агент не указал */
	status?: ReplyStatus
	/** причина после статуса */
	reason?: string
}
