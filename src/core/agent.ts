/**
 * Agent — один субагент = одна независимая сессия nessy внутри Space.
 *
 *   starting → idle ⇄ working → (error | dead);  sleeping — восстановлен из state.json, ещё не подключён.
 *
 * Сообщения доставляются через очередь: пока агент работает, новые ждут,
 * поэтому порядок и авторство (кто что кому отправил) сохраняются.
 */
import type {
	AgentEvent,
	AgentStatus,
	AgentView,
	Message,
	ToolBrief,
	ToolEvent,
} from '../../shared/types'
import type { Config } from './config'
import type { Hub } from './hub'
import { errMsg } from './json'
import {
	pickPermissionOption,
	type NessyEvent,
	type PermissionOption,
	type Subscription,
} from './nessy-client'
import type { PersistedAgent, Store } from './store'
import type { Space } from './space'
import { clip } from './util'

const MAX_TOOL_OUT = 4000

/** Что Агент требует от оркестратора (интерфейс вместо циклической зависимости). */
export interface AgentHost {
	getSpace(name: string): Space | undefined
	labelOf(id: string): string
	preambleFor(agent: Agent): string
	onTurnDone(
		agent: Agent,
		msg: Message,
		text: string,
		info: { error?: string; stopReason?: string },
	): void
	onUndeliverable(agent: Agent, msg: Message, reason: string): void
	saveSoon(): void
}

export interface AgentDeps {
	host: AgentHost
	hub: Hub
	store: Store
	config: Config
}

type NewEvent = AgentEvent extends infer E
	? E extends AgentEvent
		? Omit<E, 'seq' | 'ts'>
		: never
	: never

interface CurrentTurn {
	msg: Message
	promptId: string | null
	text: string
	startedAt: string
}

interface PendingPermission {
	requestId: string
	title: string
	options: PermissionOption[]
}

export interface AgentInit {
	id: string
	name: string
	space: string
	parent: string
	status?: AgentStatus
}

export class Agent {
	readonly id: string
	readonly name: string
	readonly space: string
	readonly parent: string
	createdAt = new Date().toISOString()
	sessionId: string | null = null
	displayName: string | null = null
	lastEventId: number | null = null
	introduced = false
	status: AgentStatus
	error: string | null = null
	queue: Message[] = []
	evSeq = 0
	lastActivityAt = this.createdAt
	lastReply = ''

	private current: CurrentTurn | null = null
	private run: {
		kind: 'text' | 'thought'
		seq: number
		ts: number
		text: string
	} | null = null
	private readonly tools = new Map<string, ToolEvent>()
	private lastTool: ToolBrief | null = null
	private readonly pending = new Map<string, PendingPermission>()
	private sub: Subscription | null = null
	private attaching: Promise<void> | null = null
	private pumping = false

	constructor(
		init: AgentInit,
		private readonly deps: AgentDeps,
	) {
		this.id = init.id
		this.name = init.name
		this.space = init.space
		this.parent = init.parent
		this.status = init.status ?? 'starting'
	}

	static restore(p: PersistedAgent, deps: AgentDeps): Agent {
		const a = new Agent(
			{ id: p.id, name: p.name, space: p.space, parent: p.parent },
			deps,
		)
		a.createdAt = p.createdAt
		a.sessionId = p.sessionId
		a.displayName = p.displayName
		a.lastEventId = p.lastEventId
		a.introduced = p.introduced
		a.queue = p.queue
		a.evSeq = p.evSeq
		a.lastActivityAt = p.lastActivityAt
		a.lastReply = p.lastReply
		a.error = p.error
		// восстановленный агент «спит» до первого обращения; dead остаётся dead
		a.status = p.status === 'dead' ? 'dead' : 'sleeping'
		for (const e of deps.store.readEvents(p.id, 50))
			if (e.seq > a.evSeq) a.evSeq = e.seq
		return a
	}

	// ---------- представление ----------
	toJSON(): AgentView {
		return {
			id: this.id,
			name: this.name,
			space: this.space,
			parent: this.parent,
			status: this.status,
			error: this.error,
			displayName: this.displayName,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			queued: this.queue.length,
			turnStartedAt: this.current?.startedAt ?? null,
			lastTool: this.lastTool,
			preview: clip(this.current?.text || this.lastReply, 140),
			pendingPermissions: [...this.pending.values()].map(p => ({
				requestId: p.requestId,
				title: p.title,
			})),
		}
	}

	persist(): PersistedAgent {
		return {
			id: this.id,
			name: this.name,
			space: this.space,
			parent: this.parent,
			createdAt: this.createdAt,
			sessionId: this.sessionId,
			displayName: this.displayName,
			lastEventId: this.lastEventId,
			introduced: this.introduced,
			status: this.status,
			error: this.error,
			queue: this.queue,
			evSeq: this.evSeq,
			lastActivityAt: this.lastActivityAt,
			lastReply: this.lastReply,
		}
	}

	get isBusy(): boolean {
		return this.current !== null
	}

	/** Сообщение, которое агент обрабатывает сейчас (для расчёта hops). */
	get currentMessage(): Message | null {
		return this.current?.msg ?? null
	}

	/** nessy serve пространства упал: отцепиться, завершить ход с ошибкой, уснуть до следующего обращения. */
	onSpaceDown(reason: string): void {
		this.detach()
		this.finishTurn({ error: reason })
		if (this.status !== 'dead') this.setStatus('sleeping')
	}

	private touch(): void {
		this.lastActivityAt = new Date().toISOString()
	}

	private setStatus(status: AgentStatus, error: string | null = null): void {
		this.status = status
		this.error = error
		this.touch()
		this.publishNode()
	}

	publishNode(): void {
		this.deps.hub.publish({ t: 'agent', agent: this.toJSON() })
		this.deps.host.saveSoon()
	}

	// ---------- подключение к nessy ----------
	/** Подключить агента: создать (или поднять) сессию и подписаться на события. */
	ensureAttached(): Promise<void> {
		if (this.sub) return Promise.resolve()
		this.attaching ??= this.attach()
			.catch((e: unknown) => {
				this.setStatus('error', errMsg(e))
				this.addSystem('не удалось подключиться к nessy: ' + errMsg(e), 'error')
				throw e
			})
			.finally(() => {
				this.attaching = null
			})
		return this.attaching
	}

	private async attach(): Promise<void> {
		const space = this.deps.host.getSpace(this.space)
		if (!space) throw new Error(`пространство «${this.space}» не найдено`)
		const client = await space.ensureReady()
		let resumed = false
		if (this.sessionId && this.status === 'sleeping')
			resumed = await client.resumeSession(this.sessionId, space.path)
		if (!resumed) {
			const hadSession = this.sessionId !== null
			const { sessionId } = await client.createSession(space.path)
			this.sessionId = sessionId
			this.lastEventId = null
			this.introduced = false // новый контекст — снова представиться
			if (hadSession)
				this.addSystem(
					'сессия nessy потеряна при перезапуске — создана новая, контекст диалога сброшен',
				)
		}
		this.sub = client.subscribe(this.sessionId ?? '', {
			lastEventId: this.lastEventId,
			onEvent: (ev, id) => this.onNessyEvent(ev, id),
		})
		if (
			this.status === 'starting' ||
			this.status === 'sleeping' ||
			this.status === 'error'
		)
			this.setStatus('idle')
		else this.publishNode()
	}

	detach(): void {
		this.sub?.close()
		this.sub = null
	}

	// ---------- доставка сообщений ----------
	deliver(msg: Message): void {
		if (this.status === 'dead') {
			this.deps.host.onUndeliverable(this, msg, 'агент остановлен')
			return
		}
		this.queue.push(msg)
		this.publishNode()
		void this.pump()
	}

	private async pump(): Promise<void> {
		if (this.current || this.pumping || this.status === 'dead') return
		if (!this.queue.length) return
		this.pumping = true
		try {
			await this.ensureAttached()
		} catch (e) {
			const failed = this.queue.splice(0)
			for (const m of failed)
				this.deps.host.onTurnDone(this, m, '', { error: errMsg(e) })
			this.pumping = false
			return
		}
		this.pumping = false
		const msg = this.queue.shift()
		if (!msg || this.current) {
			if (msg) this.queue.unshift(msg)
			return
		}

		this.current = {
			msg,
			promptId: null,
			text: '',
			startedAt: new Date().toISOString(),
		}
		this.tools.clear()
		this.setStatus('working')
		this.addEvent({
			kind: 'user',
			from: msg.from,
			msgId: msg.id,
			text: msg.text,
		})
		try {
			const client = this.deps.host.getSpace(this.space)?.client
			if (!client || !this.sessionId) throw new Error('нет соединения с nessy')
			const { promptId } = await client.prompt(
				this.sessionId,
				this.buildPrompt(msg),
			)
			this.introduced = true
			if (this.current?.msg === msg) this.current.promptId = promptId
		} catch (e) {
			this.finishTurn({ error: errMsg(e) })
		}
	}

	private buildPrompt(msg: Message): string {
		const { host } = this.deps
		let body = msg.text
		if (msg.from !== 'you') {
			const sender = host.labelOf(msg.from)
			body =
				msg.kind === 'reply'
					? `[ответ агента ${sender} на твоё сообщение]\n${msg.text}`
					: `[сообщение от агента ${sender}]\n${msg.text}`
		}
		return this.introduced ? body : `${host.preambleFor(this)}\n\n${body}`
	}

	async cancel(): Promise<void> {
		const client = this.deps.host.getSpace(this.space)?.client
		if (client && this.sessionId) await client.cancel(this.sessionId)
		this.queue = []
		this.publishNode()
	}

	async close(): Promise<void> {
		this.detach()
		const client = this.deps.host.getSpace(this.space)?.client
		if (client && this.sessionId) await client.closeSession(this.sessionId)
	}

	// ---------- события nessy ----------
	private onNessyEvent(ev: NessyEvent, eventId: number | null): void {
		if (eventId !== null) {
			this.lastEventId = eventId
			this.deps.host.saveSoon()
		}
		switch (ev.kind) {
			case 'text':
			case 'thought':
				if (!this.current) return // реплей вне хода игнорируем
				this.touch()
				if (ev.kind === 'text') this.current.text += ev.text
				this.addChunk(ev.kind, ev.text)
				return
			case 'tool':
				if (!this.current) return
				this.flushRun()
				this.onTool(ev)
				return
			case 'tool_update':
				this.onToolUpdate(ev)
				return
			case 'meta':
				this.displayName = ev.displayName
				this.publishNode()
				return
			case 'permission':
				this.onPermission(ev)
				return
			case 'turn_complete':
				if (!this.current) return
				if (
					this.current.promptId &&
					ev.promptId &&
					this.current.promptId !== ev.promptId
				)
					return // устаревший реплей
				this.finishTurn({ stopReason: ev.stopReason })
				return
			case 'died':
				this.detach()
				this.finishTurn({ error: ev.reason })
				this.setStatus('dead', ev.reason)
				this.addSystem('агент остановлен: ' + ev.reason, 'error')
				return
			case 'evicted':
				this.detach()
				void this.ensureAttached().catch(() => undefined)
				return
		}
	}

	private onTool(ev: Extract<NessyEvent, { kind: 'tool' }>): void {
		const rec = this.addEvent({
			kind: 'tool',
			toolId: ev.toolId,
			name: ev.name,
			title: clip(ev.title, 200),
			input: ev.input,
			status: ev.status,
		})
		if (rec.kind === 'tool') this.tools.set(ev.toolId, rec)
		this.lastTool = {
			name: ev.name,
			title: clip(ev.title || JSON.stringify(ev.input), 120),
		}
		this.publishNode()
	}

	private onToolUpdate(ev: Extract<NessyEvent, { kind: 'tool_update' }>): void {
		const rec = this.tools.get(ev.toolId)
		if (!rec) return
		rec.status = ev.status
		rec.output = clip(ev.output, MAX_TOOL_OUT)
		this.deps.store.appendEvent(this.id, rec) // позднейшая запись с тем же seq/toolId перекрывает раннюю при чтении UI
		this.deps.hub.publish({ t: 'event', agentId: this.id, event: rec })
	}

	private onPermission(ev: Extract<NessyEvent, { kind: 'permission' }>): void {
		const space = this.deps.host.getSpace(this.space)
		if (this.deps.config.autoApprove) {
			const optionId = pickPermissionOption(ev.options, true)
			if (space?.client && this.sessionId)
				void space.client
					.vote(this.sessionId, ev.requestId, optionId)
					.catch(() => undefined)
			this.addEvent({
				kind: 'permission',
				requestId: ev.requestId,
				title: clip(ev.title, 200),
				resolved: true,
				approved: true,
				auto: true,
			})
			return
		}
		this.pending.set(ev.requestId, {
			requestId: ev.requestId,
			title: clip(ev.title, 200),
			options: ev.options,
		})
		this.addEvent({
			kind: 'permission',
			requestId: ev.requestId,
			title: clip(ev.title, 200),
			resolved: false,
		})
		this.publishNode()
	}

	async resolvePermission(
		requestId: string,
		approve: boolean,
	): Promise<boolean> {
		const p = this.pending.get(requestId)
		const client = this.deps.host.getSpace(this.space)?.client
		if (!p || !client || !this.sessionId) return false
		await client.vote(
			this.sessionId,
			requestId,
			pickPermissionOption(p.options, approve),
		)
		this.pending.delete(requestId)
		this.addEvent({
			kind: 'permission',
			requestId,
			title: p.title,
			resolved: true,
			approved: approve,
			auto: false,
		})
		this.publishNode()
		return true
	}

	private finishTurn(info: { stopReason?: string; error?: string }): void {
		const cur = this.current
		if (!cur) return
		this.current = null
		this.flushRun()
		const text = cur.text.trim()
		if (text) this.lastReply = text
		if (info.error)
			this.addSystem('ход завершился ошибкой: ' + info.error, 'error')
		if (this.status !== 'dead')
			this.setStatus(this.queue.length ? 'working' : 'idle', info.error ?? null)
		this.deps.host.onTurnDone(this, cur.msg, text, info)
		void this.pump()
	}

	// ---------- запись событий агента ----------
	private addEvent(fields: NewEvent): AgentEvent {
		const rec = { seq: ++this.evSeq, ts: Date.now(), ...fields }
		this.deps.store.appendEvent(this.id, rec)
		this.deps.hub.publish({ t: 'event', agentId: this.id, event: rec })
		this.touch()
		return rec
	}

	addSystem(text: string, level: 'info' | 'error' = 'info'): void {
		this.addEvent({ kind: 'system', level, text })
	}

	private addChunk(kind: 'text' | 'thought', delta: string): void {
		if (this.run?.kind !== kind) {
			this.flushRun()
			this.run = { kind, seq: ++this.evSeq, ts: Date.now(), text: '' }
		}
		this.run.text += delta
		this.deps.hub.publish({
			t: 'chunk',
			agentId: this.id,
			chunk: {
				seq: this.run.seq,
				ts: this.run.ts,
				kind,
				delta,
				len: this.run.text.length,
			},
		})
	}

	private flushRun(): void {
		const r = this.run
		if (!r) return
		this.run = null
		if (!r.text) return
		const rec: AgentEvent = { seq: r.seq, ts: r.ts, kind: r.kind, text: r.text }
		this.deps.store.appendEvent(this.id, rec)
		this.deps.hub.publish({ t: 'event', agentId: this.id, event: rec })
	}

	/** Незавершённый блок текста (для снапшота при подключении UI). */
	liveRun(): {
		seq: number
		ts: number
		kind: 'text' | 'thought'
		text: string
	} | null {
		return this.run ? { ...this.run } : null
	}
}
