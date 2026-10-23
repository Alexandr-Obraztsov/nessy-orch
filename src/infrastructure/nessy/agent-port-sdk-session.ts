/**
 * Состояние и очередь сессии адаптера nessy-sdk. Выделено из agent-port-sdk.ts по единой ответственности:
 * «очередь промптов + состояние хэндла» — механика, которую держит NessySdkAgentPort (операции и маппинг событий).
 */
import type { PermissionResult, Query, SDKUserMessage } from '@nestor/nessy-cli-sdk'
import type { PortEventListener } from '../../application/agent-port'
import { errMsg } from '../../lib/json'

/** Состояние сессии: query-хэндл, очередь промптов, счётчик seq, открытый ход, текущий подписчик. */
export interface SessionState {
	id: string
	query: Query
	queue: PromptQueue
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
	/** запросы разрешений: requestId → резолвер canUseTool. */
	permissions: Map<string, (r: PermissionResult) => void>
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
