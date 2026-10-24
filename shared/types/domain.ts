/** Доменные сущности: узлы графа, пространства, агенты, сообщения ленты. */

/** Идентификатор узла графа: `you` либо id агента. */
export type NodeId = string

/** Рантайм, на котором работает агент/пространство: nessy-sdk — встроенный SDK, tclaude — headless Claude Code. */
export type RuntimeId = 'nessy-sdk' | 'tclaude'

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
	/** рантайм пространства; нет в старых состояниях (→ nessy-sdk) */
	runtime?: RuntimeId
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
 * у каждой сессии свои источники и счётчики. Приложение показывает сессии по отдельности или рядом.
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
	/** размер контекста по последнему ходу (входные токены), null — ходов с данными ещё не было */
	contextTokens?: number | null
	/** доля окна контекста, % (0–100+): у малого окна агента ответ деградирует — новую задачу лучше отдать новому агенту */
	contextPct?: number | null
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
	/** кто ведёт сессию: свободная метка оркестратора (например `lead`, имя окна) или null */
	owner: string | null
	status: SessionStatus
	/** итог сессии от оркестратора (session done --summary), markdown */
	summary: string | null
	createdAt: string
	updatedAt: string
	/** сколько источников собрано за сессию (список — GET /sessions/:id/sources) */
	sources: number
	/** id чата Claude Code (`--session-id`, для `--resume`), к которому привязана сессия */
	chatId?: string | null
	/** каталог чата Claude (cwd из хука): агенты сессии запускаются здесь, отдельные каталоги не нужны */
	cwd?: string | null
	/** после `/clear` или `/resume` внутри Claude вкладка продолжается в другой сессии (чат другой): id её; вкладка идёт по цепочке к последней */
	successor?: string | null
}

export interface AgentView {
	id: string
	/** служебное имя (по нему обращаются `send <имя>`): назначает оркестратор, уникально */
	name: string
	/** короткий заголовок от того, кто запустил агента (поручение — отдельно); null — не задан */
	title: string | null
	space: string
	/** id сессии (SessionView.id) или null — агент вне сессий */
	session: string | null
	parent: NodeId
	/** id роли (RoleView.id) или null */
	role: string | null
	status: AgentStatus
	/** рантайм агента (пространства); нет в старых состояниях (→ nessy-sdk) */
	runtime?: RuntimeId
	/**
	 * Модель агента. Фактическая, если адаптер её подтвердил (system/init, `model.switched`, `modelConfirmed=true`);
	 * до подтверждения — запрошенная (запрос spawn → роль → пространство → дефолт рантайма); null — дефолт рантайма.
	 */
	model?: string | null
	/** запрошенная модель, если фактическая от неё отличается (рантайм молча подставил другую): UI показывает предупреждение; иначе null */
	modelRequested?: string | null
	/** `model` подтверждена рантаймом (а не только запрошена) */
	modelConfirmed?: boolean
	/**
	 * Скрыт из рабочего списка: сессия выполнена. Сессия сохранена — сообщение агенту
	 * (или POST /agents/:ref/restore) возвращает его в работу с прежним контекстом.
	 */
	archived: boolean
	/** сессия nessy закрыта по простою (контекст на диске): следующее сообщение поднимет её; на работу агента не влияет */
	parked: boolean
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
	/** сессия отправителя-агента на момент ответа: ответ не теряется, даже если агента потом удалили или отвязали от сессии */
	session?: string
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
	/** имя иконки (SF Symbols), например `magnifyingglass`; null — без иконки */
	icon: string | null
	/** модель субагента (псевдоним или id модели рантайма); null/нет — по умолчанию (модель пространства, затем дефолт рантайма) */
	model?: string | null
	/** рантайм субагента; null/нет — как у пространства. Подсказка: действует, только если пространство создаётся под этого агента */
	runtime?: RuntimeId | null
	/** у роли есть пакет файлов (`role-packages/<id>`): `{{role_dir}}` в инструкциях заменяется путём к нему */
	package?: boolean
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

/** Что рантайм умеет (флаги AgentPort); UI по ним включает и выключает действия. */
export interface RuntimeCapabilities {
	/** смена модели у живого агента (`POST /agents/:ref/model`) */
	setModel: boolean
	/** доставка сообщения в идущий ход без прерывания */
	midTurn: boolean
	/** голосование по запросам разрешений */
	permissionVote: boolean
	/** стриминг текста чанками */
	streamText: boolean
}

/** Модель в каталоге рантайма: id — то, что передаётся в `model` (псевдоним или полный id); label — для показа. */
export interface RuntimeModel {
	id: string
	label: string
}

/** Рантайм из каталога `GET /runtimes`. Список моделей — подсказка: свободный ввод модели при запуске допустим. */
export interface RuntimeInfo {
	id: RuntimeId
	label: string
	/** модель по умолчанию из конфигурации сервера (ORCH_SDK_MODEL / ORCH_TCLAUDE_MODEL); null — дефолт самого рантайма */
	defaultModel: string | null
	/** известные модели: дефолт конфигурации, подтверждённые псевдонимы, модели пространств и агентов (без выдуманных) */
	models: RuntimeModel[]
	capabilities: RuntimeCapabilities
	/** рантайм можно запустить на этой машине (tclaude найден; nessy-sdk встроен) */
	available: boolean
}
