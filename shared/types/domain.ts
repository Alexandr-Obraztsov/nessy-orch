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

/**
 * Задача («ящик») — единица работы одного оркестратора (сессии Claude). Каждый Claude заводит свою
 * задачу и запускает агентов в ней; несколько Claude работают параллельно, не мешая друг другу:
 * у каждой задачи свой inbox. UI показывает задачи по отдельности или рядом.
 */
export type TaskStatus = 'active' | 'done'

export interface TaskView {
	/** slug: латиница, цифры, дефис (например `fix-ci-3f2a`) */
	id: string
	title: string
	/** кто ведёт задачу: свободная метка оркестратора (например `claude`, имя окна) или null */
	owner: string | null
	status: TaskStatus
	/** итог задачи от оркестратора (task done --summary), markdown */
	summary: string | null
	createdAt: string
	updatedAt: string
}

export interface AgentView {
	id: string
	name: string
	space: string
	/** id задачи (TaskView.id) или null — агент вне задач */
	task: string | null
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
	/** план агента (сообщил сам через `nessy-orch plan` или ACP `plan`); null — плана нет */
	plan: AgentPlan | null
	/** число вызовов инструментов в текущем (или последнем) ходе */
	turnSteps: number
	/** длительность последнего завершённого хода, мс (null — ходов ещё не было) */
	lastTurnMs: number | null
	/** последний ответ агента оператору (you) */
	lastReply: ReplyBrief | null
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

export interface ReplyBrief {
	msgId: string
	ts: number
	/** причина, если ход завершился ошибкой */
	failed?: string
	/** первые ~200 символов ответа */
	preview: string
}
