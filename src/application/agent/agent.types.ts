/** Типы агента и его окружения (интерфейсы вместо циклических зависимостей). */
import type { AgentEvent, AgentPlan, AgentStats, AgentStatus, Message, PlanEntry, ReplyBrief, ToolBrief } from '../../../shared/types'
import type { AgentIdentity, PermissionOption, TurnOutcome } from '../../domain/types'
import type { Hub } from '../hub'
import type { Clock, SpaceRuntime, StorePort } from '../ports'
import type { AgentJournal } from './agent-journal'
import type { Envelope, PortSubscription } from '../agent-port'

/** Что агент требует от оркестратора — узкий интерфейс колбэков (без цикла agent → host → agent). */
export interface AgentCallbacks {
	getSpace(name: string): SpaceRuntime | undefined
	labelOf(id: string): string
	preambleFor(agent: AgentIdentity): string
	/** Ход завершён: опубликовать ответ отправителю. Возвращает опубликованный ответ (или null). */
	onTurnDone(agent: AgentIdentity, msg: Message, text: string, outcome: TurnOutcome): Message | null
	/** Ссылки из вызова инструмента агента → источники его сессии. */
	onToolUrls(agent: AgentIdentity, urls: readonly string[]): void
	/** Готовая заранее созданная сессия nessy для пространства (null — нет, создавать самому). */
	takeWarmSession(space: string, model: string | null): string | null
	saveSoon(): void
}

/** Полный интерфейс хоста оркестратора; сегодня это точный алиас узких колбэков агента (AgentCallbacks). */
export type AgentHost = AgentCallbacks

export interface AgentDeps {
	/** обратные вызовы в оркестратор; агент не видит весь host, только узкий интерфейс колбэков */
	callbacks: AgentCallbacks
	hub: Hub
	store: StorePort
	clock: Clock
	autoApprove: boolean
	/** ожидание подтверждения отмены от nessy (мс) */
	cancelGraceMs: number
	/** новый секретный ключ агента (для команд от его имени) */
	newKey: () => string
	/** показывать ключ агенту в вводной и напоминаниях (включена проверка токенов) */
	showKey: boolean
	/** простой агента до закрытия его сессии nessy, мс (0 — не закрывать) */
	idleCloseMs: number
	/** базовая пауза повтора промпта при временном отказе nessy (мс, растёт вдвое); по умолчанию 1000 */
	promptRetryBaseMs?: number
	/** команда CLI оркестратора (для напоминания о плане в промпте) */
	cliPath: string
	/** окно контекста, токенов (для метрики «контекст %»); по умолчанию 128000 */
	/** повторов поручения после ошибки хода; по умолчанию 0 */
	turnRetries?: number
	/** пауза перед первым повтором, мс (дальше удваивается) */
	turnRetryBaseMs?: number
}

export interface AgentInit {
	id: string
	name: string
	space: string
	parent: string
	/** id сессии (null — вне сессий) */
	session?: string | null
	role?: string | null
	/** запрошенная модель (запрос spawn → роль → пространство → дефолт); null/нет — дефолт рантайма */
	model?: string | null
	status?: AgentStatus
	key?: string
}

/** Событие агента до присвоения seq/ts. */
export type NewAgentEvent = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'seq' | 'ts'> : never) : never

/** Незавершённый блок текста/мыслей, который ещё стримится чанками. */
export interface LiveRun {
	seq: number
	ts: number
	kind: 'text' | 'thought'
	text: string
	messageId: string | null
}

export interface CurrentTurn {
	msg: Message
	promptId: string | null
	/** блоки текста хода по порядку; новый блок — при смене messageId или после вызова инструмента */
	texts: string[]
	/** messageId последнего текстового чанка */
	textMsgId: string | null
	/** после последнего текстового чанка был вызов инструмента: следующий чанк начинает новый блок */
	textBreak: boolean
	/** агент опубликовал план в этом ходе */
	planned: boolean
	/** предупреждение «нет плана» уже выдано в этом ходе */
	planWarned: boolean
	startedAt: string
	/** начало хода, мс (для lastTurnMs) */
	startedMs: number
	/** ошибка хода из nessy (`nessy/error`), применяется на turn_complete */
	error: string | null
	/** отмена запрошена (cancel / прерывание новым сообщением), ждём подтверждения nessy */
	cancelRequested: boolean
	/** промпт принят nessy (отмену можно отправлять) */
	sent: boolean
	/** сообщения, отправленные в ход без прерывания (`mid-turn-message`); confirmed — nessy подтвердил, что модель их увидела (иначе вернём в очередь) */
	injected: { msg: Message; confirmed: boolean }[]
}

export interface PendingPermission {
	requestId: string
	title: string
	options: PermissionOption[]
}

/**
 * Внутреннее состояние агента + низкоуровневые мутаторы, которыми пользуются подсистемы (подключение, ход, события).
 * Agent реализует его фактически (поля/методы приватные — подсистемы получают состояние параметром и мутируют напрямую),
 * чтобы логику можно было разносить по файлам без циклических импортов (см. agent-connection/turn/events).
 */
export interface AgentState {
	readonly id: string
	readonly name: string
	readonly space: string
	readonly parent: string
	readonly deps: AgentDeps
	session: string | null
	readonly role: string | null
	/** запрошенная модель агента (меняется сменой модели); null — дефолт пространства/рантайма */
	modelRequested: string | null
	/** фактическая модель, подтверждённая адаптером (system/init, смена); null — ещё не подтверждена */
	modelActual: string | null
	readonly key: string
	createdAt: string
	nessyId: string | null
	displayName: string | null
	title: string | null
	lastEventId: number | null
	introduced: boolean
	status: AgentStatus
	error: string | null
	queue: Message[]
	lastActivityAt: string
	lastReply: string
	plan: AgentPlan | null
	turnSteps: number
	lastTurnMs: number | null
	replyBrief: ReplyBrief | null
	archived: boolean
	parked: boolean
	stats: AgentStats
	journal: AgentJournal
	current: CurrentTurn | null
	lastTool: ToolBrief | null
	pending: Map<string, PendingPermission>
	sub: PortSubscription | null
	attaching: Promise<void> | null
	pumping: boolean
	resume: boolean
	urgent: number
	cancelTimer: NodeJS.Timeout | null
	idleTimer: NodeJS.Timeout | null
	removed: boolean
	closing: Promise<void> | null
	staleEvents: boolean
	lostTurn: Message | null
	ctxUsed: number
	ctxSize: number
	donePrompts: string[]
	retryState: { id: string; n: number; error: string } | null
	holdPump: boolean
	/** занят ли агент ходом (есть открытый ход) */
	isBusy: boolean
	/** вход событий порта (Envelope → SessionEvent → обработка); ставится при подписке на сессию */
	handlePortEvent: (envelope: Envelope) => void
	// ---------- низкоуровневые мутаторы (якорь в Agent) ----------
	touch(): void
	setStatus(status: AgentStatus, error?: string | null): void
	setSession(session: string | null): void
	publishNode(): void
	addSystem(text: string, level?: 'info' | 'error'): void
	setPlan(entries: readonly PlanEntry[] | null, source: AgentPlan['source']): void
	clearIdleTimer(): void
	clearCancelTimer(): void
	rememberDone(promptId: string): void
	isDonePrompt(promptId: string | null): boolean
	contextMetric(): Pick<AgentStats, 'contextTokens' | 'contextPct'>
	noteReply(reply: Message | null): boolean
	/** запрошенная модель агента, иначе модель пространства (null — дефолт рантайма) */
	effectiveRequestedModel(): string | null
}
