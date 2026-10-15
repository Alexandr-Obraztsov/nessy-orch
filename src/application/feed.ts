/**
 * Feed — общая лента сообщений («группчат»): нумерация, хранение и ожидание ответов (--wait).
 * Ящика входящих нет: ответ агента возвращается тому, кто его запустил или написал ему (`spawn` / `send` ждут результат сами).
 */
import type { Message } from '../../shared/types'
import type { MessageDraft } from '../domain/types'
import type { FeedDeps, FeedQuery } from './feed.types'

const MAX_MEMORY_MESSAGES = 5000
/** сколько последних сообщений читаем с диска, когда истории узла не хватает в памяти */
const DISK_HISTORY_LIMIT = 100_000

export class Feed {
	private messages: Message[] = []
	private seq = 0
	private readonly waiters = new Map<string, (reply: Message) => void>()

	constructor(private readonly deps: FeedDeps) {}

	load(msgSeq: number): void {
		this.messages = this.deps.store.loadMessages(MAX_MEMORY_MESSAGES)
		this.seq = Math.max(msgSeq, ...this.messages.map(m => m.seq), 0)
	}

	get msgSeq(): number {
		return this.seq
	}

	append(draft: MessageDraft): Message {
		const msg: Message = {
			seq: ++this.seq,
			id: 'm-' + this.deps.ids.next(6),
			ts: this.deps.clock.now(),
			from: draft.from,
			to: draft.to,
			kind: draft.kind,
			text: draft.text,
			hops: draft.hops ?? 0,
		}
		if (draft.replyTo) msg.replyTo = draft.replyTo
		if (draft.wait) msg.wait = true
		if (draft.failed) msg.failed = draft.failed
		this.messages.push(msg)
		if (this.messages.length > MAX_MEMORY_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MEMORY_MESSAGES)
		this.deps.store.appendMessage(msg)
		this.deps.hub.publish({ t: 'message', message: msg })
		this.deps.onChange()
		const waiter = msg.replyTo ? this.waiters.get(msg.replyTo) : undefined
		if (waiter && msg.kind === 'reply') waiter(msg)
		return msg
	}

	/** Дождаться ответа на сообщение. null — таймаут. */
	waitReply(messageId: string, timeoutMs: number): Promise<Message | null> {
		// ответ мог появиться синхронно ещё при отправке (агент остановлен, ошибка доставки)
		const ready = this.messages.findLast(m => m.kind === 'reply' && m.replyTo === messageId)
		if (ready) return Promise.resolve(ready)
		return new Promise(resolve => {
			const timer = setTimeout(() => {
				this.waiters.delete(messageId)
				resolve(null)
			}, timeoutMs)
			this.waiters.set(messageId, r => {
				clearTimeout(timer)
				this.waiters.delete(messageId)
				resolve(r)
			})
		})
	}

	recent(n: number): Message[] {
		return this.messages.slice(-n)
	}

	/** Сообщение по id (в окне памяти) или undefined. */
	byId(id: string): Message | undefined {
		return this.messages.findLast(m => m.id === id)
	}

	/** Последний ответ агента (в окне памяти) или undefined. */
	lastReplyOf(agentId: string): Message | undefined {
		return this.messages.findLast(m => m.kind === 'reply' && m.from === agentId)
	}

	list(q: FeedQuery = {}): Message[] {
		let list = this.messages
		const { involving, since } = q
		if (involving) list = list.filter(m => m.from === involving || m.to === involving)
		if (since !== undefined) list = list.filter(m => m.seq > since)
		const limit = q.limit ?? 200
		// в памяти хранится только хвост ленты: если по запросу узла не набралось нужное число, а лента длиннее окна, дочитываем с диска
		if (involving && list.length < limit && this.messages.length >= MAX_MEMORY_MESSAGES) {
			const older = this.deps.store
				.loadMessages(DISK_HISTORY_LIMIT)
				.filter(m => (m.from === involving || m.to === involving) && (since === undefined || m.seq > since))
			if (older.length > list.length) list = older
		}
		return list.slice(-limit)
	}

	/** Освободить ожидающих (при остановке). */
	close(): void {
		this.waiters.clear()
	}
}
