/**
 * Agent — один субагент = одна независимая сессия nessy внутри пространства.
 * Состояния и переходы — domain/agent-status.ts.
 *
 * Сообщения доставляются через очередь: пока агент работает, новые ждут,
 * поэтому порядок и авторство (кто что кому отправил) сохраняются.
 */
import type { AgentStatus, AgentView, Message, ToolBrief } from '../../../shared/types'
import { canReceive, restoredStatus, statusAfterAttach, statusAfterTurn } from '../../domain/agent-status'
import { pickPermissionOption } from '../../domain/permission'
import { framePrompt } from '../../domain/routing'
import type { AgentIdentity, TurnOutcome } from '../../domain/types'
import { errMsg } from '../../lib/json'
import { clip } from '../../lib/text'
import type { PersistedAgent } from '../persisted.types'
import type { SessionEvent, SessionSubscription } from '../ports'
import { AgentJournal } from './agent-journal'
import type { AgentDeps, AgentInit, CurrentTurn, LiveRun, PendingPermission } from './agent.types'

export class Agent implements AgentIdentity {
	readonly id: string
	readonly name: string
	readonly space: string
	readonly parent: string
	createdAt: string
	sessionId: string | null = null
	displayName: string | null = null
	lastEventId: number | null = null
	introduced = false
	status: AgentStatus
	error: string | null = null
	queue: Message[] = []
	lastActivityAt: string
	lastReply = ''

	private readonly journal: AgentJournal
	private current: CurrentTurn | null = null
	private lastTool: ToolBrief | null = null
	private readonly pending = new Map<string, PendingPermission>()
	private sub: SessionSubscription | null = null
	private attaching: Promise<void> | null = null
	private pumping = false

	constructor(
		init: AgentInit,
		private readonly deps: AgentDeps,
		evSeq = 0,
	) {
		this.id = init.id
		this.name = init.name
		this.space = init.space
		this.parent = init.parent
		this.status = init.status ?? 'starting'
		this.createdAt = this.isoNow()
		this.lastActivityAt = this.createdAt
		this.journal = new AgentJournal(init.id, deps, evSeq)
	}

	static restore(p: PersistedAgent, deps: AgentDeps): Agent {
		let evSeq = p.evSeq
		for (const e of deps.store.readEvents(p.id, 50)) if (e.seq > evSeq) evSeq = e.seq
		const a = new Agent({ id: p.id, name: p.name, space: p.space, parent: p.parent, status: restoredStatus(p.status) }, deps, evSeq)
		a.createdAt = p.createdAt
		a.sessionId = p.sessionId
		a.displayName = p.displayName
		a.lastEventId = p.lastEventId
		a.introduced = p.introduced
		a.queue = p.queue
		a.lastActivityAt = p.lastActivityAt
		a.lastReply = p.lastReply
		a.error = p.error
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
			pendingPermissions: [...this.pending.values()].map(p => ({ requestId: p.requestId, title: p.title })),
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
			evSeq: this.journal.evSeq,
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

	/** Незавершённый блок текста (для снапшота при подключении UI). */
	liveRun(): LiveRun | null {
		return this.journal.liveRun()
	}

	/** nessy serve пространства упал: отцепиться, завершить ход с ошибкой, уснуть до следующего обращения. */
	onSpaceDown(reason: string): void {
		this.detach()
		this.finishTurn({ error: reason })
		if (this.status !== 'dead') this.setStatus('sleeping')
	}

	private isoNow(): string {
		return new Date(this.deps.clock.now()).toISOString()
	}

	private touch(): void {
		this.lastActivityAt = this.isoNow()
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

	addSystem(text: string, level: 'info' | 'error' = 'info'): void {
		this.journal.add({ kind: 'system', level, text })
		this.touch()
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
		if (this.sessionId && this.status === 'sleeping') resumed = await client.resumeSession(this.sessionId, space.path)
		if (!resumed) {
			const hadSession = this.sessionId !== null
			const { sessionId } = await client.createSession(space.path)
			this.sessionId = sessionId
			this.lastEventId = null
			this.introduced = false // новый контекст — снова представиться
			if (hadSession) this.addSystem('сессия nessy потеряна при перезапуске — создана новая, контекст диалога сброшен')
		}
		this.sub = client.subscribe(this.sessionId ?? '', {
			lastEventId: this.lastEventId,
			onEvent: (ev, id) => this.onSessionEvent(ev, id),
		})
		const next = statusAfterAttach(this.status)
		if (next !== this.status) this.setStatus(next)
		else this.publishNode()
	}

	detach(): void {
		this.sub?.close()
		this.sub = null
	}

	// ---------- доставка сообщений ----------
	deliver(msg: Message): void {
		if (!canReceive(this.status)) {
			this.deps.host.onUndeliverable(this, msg, 'агент остановлен')
			return
		}
		this.queue.push(msg)
		this.publishNode()
		void this.pump()
	}

	private async pump(): Promise<void> {
		if (this.current || this.pumping || !canReceive(this.status)) return
		if (!this.queue.length) return
		this.pumping = true
		try {
			await this.ensureAttached()
		} catch (e) {
			const failed = this.queue.splice(0)
			this.pumping = false
			for (const m of failed) this.deps.host.onTurnDone(this, m, '', { error: errMsg(e) })
			return
		}
		this.pumping = false
		const msg = this.queue.shift()
		if (!msg) return
		if (this.current) {
			this.queue.unshift(msg)
			return
		}

		this.current = { msg, promptId: null, text: '', startedAt: this.isoNow(), error: null }
		this.journal.resetTools()
		this.setStatus('working')
		this.journal.add({ kind: 'user', from: msg.from, msgId: msg.id, text: msg.text })
		try {
			const client = this.deps.host.getSpace(this.space)?.client
			if (!client || !this.sessionId) throw new Error('нет соединения с nessy')
			const { promptId } = await client.prompt(this.sessionId, this.buildPrompt(msg))
			this.introduced = true
			if (this.current?.msg === msg) this.current.promptId = promptId
		} catch (e) {
			if (this.current?.msg === msg) this.finishTurn({ error: errMsg(e) })
		}
	}

	private buildPrompt(msg: Message): string {
		const { host } = this.deps
		const body = framePrompt(msg, host.labelOf(msg.from))
		return this.introduced ? body : `${host.preambleFor(this)}\n\n${body}`
	}

	async cancel(): Promise<void> {
		const client = this.deps.host.getSpace(this.space)?.client
		this.queue = []
		this.publishNode()
		if (client && this.sessionId) await client.cancel(this.sessionId)
	}

	async close(): Promise<void> {
		this.detach()
		const client = this.deps.host.getSpace(this.space)?.client
		if (client && this.sessionId) await client.closeSession(this.sessionId)
	}

	// ---------- события nessy ----------
	private onSessionEvent(ev: SessionEvent, eventId: number | null): void {
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
				this.journal.chunk(ev.kind, ev.text, ev.messageId)
				return
			case 'tool':
				this.onTool(ev)
				return
			case 'turn_error':
				if (this.current) this.current.error = ev.message
				else this.addSystem('ошибка nessy: ' + ev.message, 'error')
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
				if (this.current.promptId && ev.promptId && this.current.promptId !== ev.promptId) return // устаревший реплей
				this.finishTurn({ stopReason: ev.stopReason })
				return
			case 'cancelled':
				if (!this.current) return
				if (this.current.promptId && ev.promptId && this.current.promptId !== ev.promptId) return
				this.finishTurn({ stopReason: 'cancelled' })
				return
			case 'followup':
				return // подсказки следующего вопроса оркестратору не нужны
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

	private onTool(ev: Extract<SessionEvent, { kind: 'tool' }>): void {
		// обновление инструмента, который мы не видели, вне хода — это реплей: пропускаем
		if (!this.current && !this.journal.hasTool(ev.toolId)) return
		const [rec, created] = this.journal.upsertTool(ev)
		this.touch()
		if (created) {
			this.lastTool = { name: rec.name, title: clip(rec.title || JSON.stringify(rec.input), 120) }
			this.publishNode()
		}
	}

	private onPermission(ev: Extract<SessionEvent, { kind: 'permission' }>): void {
		const title = clip(ev.title, 200)
		if (this.deps.autoApprove) {
			const client = this.deps.host.getSpace(this.space)?.client
			const optionId = pickPermissionOption(ev.options, true)
			if (client && this.sessionId) void client.vote(this.sessionId, ev.requestId, optionId).catch(() => undefined)
			this.journal.add({ kind: 'permission', requestId: ev.requestId, title, resolved: true, approved: true, auto: true })
			this.touch()
			return
		}
		this.pending.set(ev.requestId, { requestId: ev.requestId, title, options: ev.options })
		this.journal.add({ kind: 'permission', requestId: ev.requestId, title, resolved: false })
		this.touch()
		this.publishNode()
	}

	async resolvePermission(requestId: string, approve: boolean): Promise<boolean> {
		const p = this.pending.get(requestId)
		const client = this.deps.host.getSpace(this.space)?.client
		if (!p || !client || !this.sessionId) return false
		await client.vote(this.sessionId, requestId, pickPermissionOption(p.options, approve))
		this.pending.delete(requestId)
		this.journal.add({ kind: 'permission', requestId, title: p.title, resolved: true, approved: approve, auto: false })
		this.touch()
		this.publishNode()
		return true
	}

	private finishTurn(outcome: TurnOutcome): void {
		const cur = this.current
		if (!cur) return
		this.current = null
		this.journal.flushRun()
		const info: TurnOutcome = { ...outcome }
		if (!info.error && cur.error) info.error = cur.error
		const cancelled = info.stopReason === 'cancelled'
		if (info.error || cancelled) this.journal.failOpenTools()
		// запросы разрешений, не решённые до конца хода, больше не актуальны
		this.pending.clear()
		const text = cur.text.trim()
		if (text) this.lastReply = text
		if (info.error) this.addSystem('ход завершился ошибкой: ' + info.error, 'error')
		else if (cancelled) this.addSystem('ход прерван')
		this.setStatus(statusAfterTurn(this.status, this.queue.length), info.error ?? null)
		this.deps.host.onTurnDone(this, cur.msg, text, info)
		void this.pump()
	}
}
