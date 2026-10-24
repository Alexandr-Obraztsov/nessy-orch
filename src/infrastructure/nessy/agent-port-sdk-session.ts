/**
 * Состояние и очередь сессии адаптера nessy-sdk. Выделено из agent-port-sdk.ts по единой ответственности:
 * «очередь промптов + состояние хэндла» — механика, которую держит NessySdkAgentPort (операции и маппинг событий).
 */
import type { PermissionResult, Query, SDKMessage, SDKUserMessage } from '@nestor/nessy-cli-sdk'
import type { PortEventListener } from '../../application/agent-port'
import { errMsg } from '../../lib/json'

/** Запрос разрешения: резолвер canUseTool + заявленные опции (для строгого permission.vote). */
export interface PendingPermission {
	resolve: (r: PermissionResult) => void
	options: { optionId: string; kind: string; name: string }[]
}

/** Закрытая сессия, сохранённая для §6б-резюма (честное восстановление контекста, не теряется при park). */
export interface ClosedSession {
	lastSeq: number
	model: string | null
	cwd: string
}

/** Состояние сессии: query-хэндл, очередь промптов, счётчик seq, открытый ход, текущий подписчик. */
export interface SessionState {
	id: string
	query: Query | null
	queue: PromptQueue
	/** id сессии для резюма через SDK QueryOptions.resume (null — свежая сессия через sessionId). */
	resume: string | null
	/** abort-контроллер, переданный SDK: abort() на close/forceClose принудительно гасит процесс. */
	abortController: AbortController
	/** монотонный per-session счётчик для Envelope.seq */
	seq: number
	/** подписчик событий (один на сессию). */
	subscriber: PortEventListener | null
	/** открыт ли ход (turn.started эмичен, терминала ещё не было). */
	turnOpen: boolean
	/** id идущего хода (для turn.completed/turn.failed/turn.cancelled). */
	promptId: string | null
	/** накопленный текст текущего хода (для message.completed). */
	text: string
	/** синтез готовности: session.ready ещё не эмичен. */
	ready: boolean
	/** запросы разрешений: requestId → резолвер canUseTool + опции. */
	permissions: Map<string, PendingPermission>
	/** модель, сообщённая в system/init. */
	actualModel: string | null
	/** закрыт ли хэндл (query больше не использовать). */
	closed: boolean
	/** отправлен ли первый промпт: по нему синтезируется session.meta (displayName), как у serve-пути. */
	named: boolean
}

/** Очередь промптов: async-итератор, который блокируется, пока нет промпта (модель «персистентная сессия»). */
export class PromptQueue implements AsyncIterable<SDKUserMessage> {
	private readonly items: SDKUserMessage[] = []
	private readonly waiters: Array<(r: IteratorResult<SDKUserMessage>) => void> = []
	private ended = false

	push(msg: SDKUserMessage): void {
		const w = this.waiters.shift()
		if (w) w({ value: msg, done: false })
		else this.items.push(msg)
	}

	/** Закрыть очередь: SDK завершит ввод и, дождавшись result, закроет процесс. */
	end(): void {
		if (this.ended) return
		this.ended = true
		for (const w of this.waiters.splice(0)) w({ value: undefined, done: true })
	}

	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		return {
			next: (): Promise<IteratorResult<SDKUserMessage>> => {
				const item = this.items.shift()
				if (item) return Promise.resolve({ value: item, done: false })
				if (this.ended) return Promise.resolve({ value: undefined, done: true })
				return new Promise<IteratorResult<SDKUserMessage>>(resolve => this.waiters.push(resolve))
			},
		}
	}
}

/** Признак грязного выхода CLI по interrupt(): код 130 (SIGINT). */
export function isExit130(e: unknown): boolean {
	const s = errMsg(e)
	return /code 130|exit code 130|SIGINT/.test(s)
}

/** Начальное состояние хэндла сессии (свежая или §6б-резюм). */
export function createSdkSessionState(
	sessionId: string,
	init: { resume: string | null; seq: number; actualModel: string | null; named: boolean },
): SessionState {
	return {
		id: sessionId,
		query: null,
		queue: new PromptQueue(),
		resume: init.resume,
		abortController: new AbortController(),
		seq: init.seq,
		subscriber: null,
		turnOpen: false,
		promptId: null,
		text: '',
		ready: false,
		permissions: new Map(),
		actualModel: init.actualModel,
		closed: false,
		named: init.named,
	}
}

/** UnifiedUsage из result.usage: used из total_tokens (или input+output), size из modelUsage[].contextWindow (A4 LOW). */
export function usageOfResult(msg: Extract<SDKMessage, { type: 'result' }>): { used: number; size: number } {
	const u = msg.usage
	const inputTokens = u.input_tokens
	const outputTokens = u.output_tokens
	const total = u.total_tokens ?? null
	// размер окна контекста result-usage не отдаёт: берём из modelUsage[].contextWindow, если он доступен.
	// Известное ограничение: живой usage от nessy не всегда несёт окно — тогда size=0 (метрика «% контекста»
	// не считается), см. A4 LOW.
	let size = 0
	const modelUsage = msg.modelUsage
	if (modelUsage) {
		const first = Object.values(modelUsage)[0]
		if (first && typeof first.contextWindow === 'number') size = first.contextWindow
	}
	return { used: total === null ? inputTokens + outputTokens : total, size }
}
