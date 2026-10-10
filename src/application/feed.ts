/**
 * Feed — общая лента сообщений («группчат»): нумерация, хранение, ожидание ответов (--wait)
 * и входящие для `you` (inbox с курсором и long-poll): общий курсор и отдельный курсор на каждую сессию.
 */
import type { InboxResponse, Message } from '../../shared/types'
import { YOU } from '../domain/constants'
import type { MessageDraft } from '../domain/types'
import type { FeedDeps, FeedQuery, InboxQuery } from './feed.types'

const MAX_MEMORY_MESSAGES = 5000

export class Feed {
	private messages: Message[] = []
	private seq = 0
	private cursor = 0
	/** курсоры inbox по сессиям: каждый оркестратор читает ответы своей сессии, не сдвигая чужие */
	private readonly sessionCursors = new Map<string, number>()
	private closed = false
	private readonly waiters = new Map<string, (reply: Message) => void>()
	private readonly inboxWaiters = new Set<() => void>()

	constructor(private readonly deps: FeedDeps) {}

	load(msgSeq: number, inboxCursor: number, sessionCursors: Readonly<Record<string, number>> = {}): void {
		this.messages = this.deps.store.loadMessages(MAX_MEMORY_MESSAGES)
		this.seq = Math.max(msgSeq, ...this.messages.map(m => m.seq), 0)
		this.cursor = inboxCursor
		this.sessionCursors.clear()
		for (const [session, c] of Object.entries(sessionCursors)) this.sessionCursors.set(session, c)
	}

	get msgSeq(): number {
		return this.seq
	}

	get inboxCursor(): number {
		return this.cursor
	}

	/** Курсоры inbox по сессиям (для сохранения). */
	sessionCursorsSnapshot(): Record<string, number> {
		return Object.fromEntries(this.sessionCursors)
	}

	/** Сессию удалили — её курсор больше не нужен. */
	forgetSession(session: string): void {
		if (this.sessionCursors.delete(session)) this.deps.onChange()
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
		if (msg.to === YOU) for (const wake of [...this.inboxWaiters]) wake()
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

	list(q: FeedQuery = {}): Message[] {
		let list = this.messages
		const { involving, since } = q
		if (involving) list = list.filter(m => m.from === involving || m.to === involving)
		if (since !== undefined) list = list.filter(m => m.seq > since)
		return list.slice(-(q.limit ?? 200))
	}

	/**
	 * Входящие для `you`. peek=true не двигает курсор. wait — long-poll (сек).
	 * session — только ответы агентов этой сессии, со своим курсором (по умолчанию — с начала ленты).
	 */
	async inbox(q: InboxQuery = {}): Promise<InboxResponse> {
		const session = q.session
		const after = q.after ?? (session === undefined ? this.cursor : (this.sessionCursors.get(session) ?? 0))
		const mine = (m: Message): boolean => session === undefined || this.deps.sessionOf(m.from) === session
		const read = (): Message[] => this.messages.filter(m => m.to === YOU && m.kind === 'reply' && m.seq > after && mine(m))
		let list = read()
		const deadline = Date.now() + (q.wait ?? 0) * 1000
		// будят любые сообщения к you (в том числе чужих сессий) — ждём своего до дедлайна
		while (!list.length && !this.closed && Date.now() < deadline) {
			await this.sleepUntilMessage(deadline - Date.now())
			list = read()
		}
		const cursor = list.length ? (list[list.length - 1] as Message).seq : after
		if (!q.peek && q.after === undefined && list.length) {
			if (session === undefined) this.cursor = cursor
			else this.sessionCursors.set(session, cursor)
			this.deps.onChange()
		}
		return { messages: list, cursor }
	}

	/** Ждать нового сообщения к you не дольше ms. */
	private sleepUntilMessage(ms: number): Promise<void> {
		return new Promise<void>(resolve => {
			const done = (): void => {
				clearTimeout(timer)
				this.inboxWaiters.delete(done)
				resolve()
			}
			const timer = setTimeout(done, ms)
			this.inboxWaiters.add(done)
		})
	}

	/** Освободить висящие long-poll/ожидания (при остановке). */
	close(): void {
		this.closed = true
		for (const wake of [...this.inboxWaiters]) wake()
	}
}
