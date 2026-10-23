/**
 * Контракт AgentPort — единый порт ядра к любому агенту-рантайму (nessy serve, nessy SDK, tclaude, позднее A2A).
 * Ядро не знает протокол рантайма: оно управляет агентом только через операции и читает его состояние из событий
 * Envelope. Дизайн — docs/superpowers/specs/2026-10-23-agentport-core-design.md §3.
 *
 * Принципы:
 *  - события обязаны прийти через порт, но не обязаны быть нативными — адаптер вправе синтезировать их из своих
 *    действий (§3 «Правило происхождения»);
 *  - модель адаптер не доверяет опции/флагу, а сверяет фактическую модель из `system/init` (см. verifyModel).
 */
import type { SessionEvent } from './ports'

// ---------- операции ----------
/** Операции AgentPort над сессией агента. */
export type AgentPortOperation =
	'session.create' | 'session.resume' | 'prompt.send' | 'prompt.cancel' | 'permission.vote' | 'model.set' | 'mid_turn.send' | 'session.close'

// ---------- конверт ----------
/** Конверт события/операции. `v` — версия контракта (ломaющий SPOF-контракт, §12); `seq`/`ts` — сквозные счётчик/время. */
export interface Envelope {
	v: 1
	sessionId?: string | null
	seq?: number
	ts?: number
	originatorClientId?: string | null
	type: string
	data: unknown
}

// ---------- обязательные события ядра (11) ----------
export type CoreEventType =
	| 'session.ready'
	| 'turn.started'
	| 'message.delta'
	| 'message.completed'
	| 'tool_call.started'
	| 'tool_call.completed'
	| 'turn.completed'
	| 'turn.failed'
	| 'turn.cancelled'
	| 'error'
	| 'session.closed'

/** Обязательные события ядра: любой адаптер обязан уметь их синтезировать (§3). */
export type CoreEvent =
	| { type: 'session.ready'; data: { sessionId: string } }
	| { type: 'turn.started'; data: { promptId: string | null } }
	| { type: 'message.delta'; data: { messageId: string | null; text: string } }
	| { type: 'message.completed'; data: { messageId: string | null; text: string } }
	| { type: 'tool_call.started'; data: { toolId: string; name: string; title?: string; input: Record<string, unknown> } }
	| { type: 'tool_call.completed'; data: { toolId: string; name: string; title?: string; input?: Record<string, unknown>; status: string; output: string } }
	| { type: 'turn.completed'; data: { stopReason: string; promptId: string | null } }
	| { type: 'turn.failed'; data: { message: string; retryable: boolean; code: number | null } }
	| { type: 'turn.cancelled'; data: { promptId: string | null } }
	| { type: 'error'; data: { message: string; reason?: 'died' | 'evicted' } }
	| { type: 'session.closed'; data: { sessionId: string } }

// ---------- опциональные события (12) ----------
export type ExtEventType =
	| 'session.meta'
	| 'permission.requested'
	| 'permission.resolved'
	| 'tool_call.delta'
	| 'thought.delta'
	| 'plan.updated'
	| 'model.switched'
	| 'model.switch_failed'
	| 'mid_turn.injected'
	| 'context.usage'
	| 'user_message.delta'
	| 'session.resync'

/** Опциональные события: адаптеры реализуют по мере возможности. `plan.updated` и `tool_call.delta` в P0–P3 не реализуются. */
export type ExtEvent =
	| { type: 'session.meta'; data: { displayName?: string | null; data?: Record<string, unknown> } }
	| { type: 'permission.requested'; data: { requestId: string; title: string; options: { optionId: string; kind: string; name: string }[] } }
	| { type: 'permission.resolved'; data: { requestId: string; optionId: string | null } }
	| { type: 'tool_call.delta'; data: { toolId: string; status: string } }
	| { type: 'thought.delta'; data: { messageId: string | null; text: string } }
	| { type: 'plan.updated'; data: { entries: { content: string; status: string }[] } }
	| { type: 'model.switched'; data: { model: string } }
	| { type: 'model.switch_failed'; data: { expected: string; actual: string | null; message: string } }
	| { type: 'mid_turn.injected'; data: { count: number } }
	| { type: 'context.usage'; data: { used: number; size: number } }
	| { type: 'user_message.delta'; data: { text: string } }
	| { type: 'session.resync'; data: { hint?: string } }

/** Любое событие порта (обязательное или опциональное). */
export type PortEvent = CoreEvent | ExtEvent

/** Все имена событий порта (для валидации). */
export const CORE_EVENT_TYPES: readonly CoreEventType[] = [
	'session.ready',
	'turn.started',
	'message.delta',
	'message.completed',
	'tool_call.started',
	'tool_call.completed',
	'turn.completed',
	'turn.failed',
	'turn.cancelled',
	'error',
	'session.closed',
]

export const EXT_EVENT_TYPES: readonly ExtEventType[] = [
	'session.meta',
	'permission.requested',
	'permission.resolved',
	'tool_call.delta',
	'thought.delta',
	'plan.updated',
	'model.switched',
	'model.switch_failed',
	'mid_turn.injected',
	'context.usage',
	'user_message.delta',
	'session.resync',
]

// ---------- capability-флаги ----------
/** Что адаптер умеет. Остальные возможности выводятся из фактических событий/операций, а не декларируются (§3). */
export interface Capabilities {
	/** стриминг текста чанками (message.delta) */
	streamText: boolean
	/** доставка сообщения в идущий ход без прерывания */
	midTurn: boolean
	/** голосование по запросу разрешения */
	permissionVote: boolean
	/** смена модели на живой сессии */
	setModel: boolean
}

// ---------- единый учёт токенов ----------
/** UnifiedUsage — единый формат расхода для всех рантаймов; perModel и кэш-счётчики добавляются при появлении потребителя. */
export interface UnifiedUsage {
	inputTokens: number
	outputTokens: number
	totalTokens: number | null
	costUsd: number | null
	numTurns: number
	durationMs: number | null
}

// ---------- правило верификации модели ----------
/**
 * Правило верификации модели: адаптер НЕ доверяет опции/флагу модели — он сверяет фактическую модель из
 * `system/init` рантайма. nessy SDK молча фолбэчится, tclaude `--model opus` молча падает в дефолт.
 * При расхождении адаптер обязан эмитить `model.switch_failed` (или ошибку спавна).
 */
export interface ModelVerifyResult {
	expected: string
	actual: string | null
	matched: boolean
}

// ---------- порт ----------
/** Обратный вызов на событие порта. `envelope` — сериализованный Envelope (data уже преобразовано в PortEvent). */
export type PortEventListener = (envelope: Envelope) => void

export interface PortSubscription {
	close(): void
}

export interface PortSubscribeOptions {
	/** продолжить подписку с этого seq (Last-Event-ID); null — с начала */
	lastSeq?: number | null
	onEvent: PortEventListener
}

/**
 * AgentPort — порт управления одним агентом-рантаймом. Операции возвращают идентификаторы/статусы;
 * фактический прогресс приходит событиями через subscribe(). Операции `model.set` и `mid_turn.send` —
 * только если соответствующий capability-флаг true.
 */
export interface AgentPort {
	readonly capabilities: Capabilities
	/** создать новую сессию; возвращает sessionId */
	sessionCreate(cwd: string): Promise<{ sessionId: string }>
	/** поднять закрытую/пережившую рестарт сессию; null — сессии нет */
	sessionResume(sessionId: string, cwd: string): Promise<{ lastSeq: number | null } | null>
	/** отправить промпт (асинхронно — результат событиями) */
	promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }>
	/** прервать идущий ход (отмена хода, не interrupt: отмена реализуется per-runtime) */
	promptCancel(sessionId: string): Promise<void>
	/** проголосовать по запросу разрешения; optionId=null — отмена */
	permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void>
	/** сменить модель; только при capabilities.setModel */
	modelSet(sessionId: string, model: string): Promise<void>
	/** доставить сообщение в идущий ход без прерывания; false — сессия простаивает/очередь полна */
	midTurnSend(sessionId: string, message: string): Promise<boolean>
	/** закрыть сессию */
	sessionClose(sessionId: string): Promise<void>
	/** подписка на события сессии */
	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription
}

/**
 * Минимальный адаптер (§3): 4 операции (create/prompt.send/prompt.cancel/close) + обязательные события.
 * Адаптер вправе синтезировать события из собственных действий (см. PortEvent и правило происхождения).
 */

// ---------- маппинг SessionEvent ↔ PortEvent ----------
/**
 * Слияние NessyGateway + SessionEvent в один порт (§3). Существующий SessionEvent не ломается: здесь показан
 * маппинг SessionEvent → PortEvent (CoreEvent/ExtEvent). Обратный маппинг (PortEvent → SessionEvent) нужен
 * только если ядро продолжает потреблять старую форму и приводится в тестах.
 */
export function sessionEventToPortEvent(ev: SessionEvent): PortEvent | null {
	switch (ev.kind) {
		case 'text':
			return { type: 'message.delta', data: { messageId: ev.messageId, text: ev.text } }
		case 'thought':
			return { type: 'thought.delta', data: { messageId: ev.messageId, text: ev.text } }
		case 'tool':
			return ev.status === 'completed' || ev.status === 'failed'
				? {
						type: 'tool_call.completed',
						data: {
							toolId: ev.toolId,
							name: ev.name,
							...(ev.title ? { title: ev.title } : {}),
							...(Object.keys(ev.input).length ? { input: ev.input } : {}),
							status: ev.status,
							output: ev.output,
						},
					}
				: { type: 'tool_call.started', data: { toolId: ev.toolId, name: ev.name, ...(ev.title ? { title: ev.title } : {}), input: ev.input } }
		case 'turn_complete':
			return { type: 'turn.completed', data: { stopReason: ev.stopReason, promptId: ev.promptId } }
		case 'turn_error':
			return { type: 'turn.failed', data: { message: ev.message, retryable: ev.retryable, code: ev.code } }
		case 'cancelled':
			return { type: 'turn.cancelled', data: { promptId: ev.promptId } }
		case 'meta':
			return { type: 'session.meta', data: { displayName: ev.displayName } }
		case 'permission':
			return { type: 'permission.requested', data: { requestId: ev.requestId, title: ev.title, options: ev.options } }
		case 'followup':
			return null // подсказка продолжения — не событие контракта
		case 'plan':
			return { type: 'plan.updated', data: { entries: ev.entries } }
		case 'died':
			return { type: 'error', data: { message: ev.reason, reason: 'died' } }
		case 'evicted':
			return { type: 'error', data: { message: 'клиент вытеснен из сессии', reason: 'evicted' } }
		case 'resync':
			return { type: 'session.resync', data: {} }
		case 'injected':
			return { type: 'mid_turn.injected', data: { count: ev.count } }
		case 'usage':
			return { type: 'context.usage', data: { used: ev.used, size: ev.size } }
		case 'closed':
			return { type: 'session.closed', data: { sessionId: '' } }
	}
}

/**
 * Обратный маппинг PortEvent → SessionEvent (для старых потребителей и тестов контракта). Не покрытые события
 * (error, session.ready и пр.) возвращают null — они в старую форму не сворачиваются.
 */
export function portEventToSessionEvent(ev: PortEvent): SessionEvent | null {
	switch (ev.type) {
		case 'message.delta':
			return { kind: 'text', text: ev.data.text, messageId: ev.data.messageId }
		case 'thought.delta':
			return { kind: 'thought', text: ev.data.text, messageId: ev.data.messageId }
		case 'tool_call.started':
			return {
				kind: 'tool',
				toolId: ev.data.toolId,
				name: ev.data.name,
				title: ev.data.title ?? ev.data.name,
				input: ev.data.input,
				status: 'in_progress',
				output: '',
			}
		case 'tool_call.completed':
			return {
				kind: 'tool',
				toolId: ev.data.toolId,
				name: ev.data.name,
				title: ev.data.title ?? ev.data.name,
				input: ev.data.input ?? {},
				status: ev.data.status as 'completed' | 'failed',
				output: ev.data.output,
			}
		case 'turn.completed':
			return { kind: 'turn_complete', stopReason: ev.data.stopReason, promptId: ev.data.promptId }
		case 'turn.failed':
			return { kind: 'turn_error', message: ev.data.message, retryable: ev.data.retryable, code: ev.data.code }
		case 'turn.cancelled':
			return { kind: 'cancelled', promptId: ev.data.promptId }
		case 'permission.requested':
			return { kind: 'permission', requestId: ev.data.requestId, title: ev.data.title, options: ev.data.options }
		case 'plan.updated':
			return { kind: 'plan', entries: ev.data.entries.map(e => ({ content: e.content, status: e.status as 'pending' | 'in_progress' | 'completed' })) }
		case 'mid_turn.injected':
			return { kind: 'injected', count: ev.data.count }
		case 'session.meta':
			return { kind: 'meta', displayName: ev.data.displayName ?? '' }
		case 'session.resync':
			return { kind: 'resync' }
		case 'context.usage':
			return { kind: 'usage', used: ev.data.used, size: ev.data.size }
		case 'session.closed':
			return { kind: 'closed' }
		case 'error':
			if (ev.data.reason === 'died') return { kind: 'died', reason: ev.data.message }
			if (ev.data.reason === 'evicted') return { kind: 'evicted' }
			return null
		default:
			return null
	}
}
