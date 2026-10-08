/**
 * Agent — один субагент = одна независимая сессия nessy внутри пространства.
 * Состояния и переходы — domain/agent-status.ts.
 *
 * Сообщения доставляются через очередь: пока агент работает, новые ждут,
 * поэтому порядок и авторство (кто что кому отправил) сохраняются.
 * Срочное сообщение (interrupt) встаёт в начало очереди и прерывает текущий ход: следующий промпт уходит
 * только после подтверждения отмены от nessy (или по истечении cancelGraceMs — тогда поздние события
 * прерванного промпта игнорируются).
 *
 * Успешно закончив ход с пустой очередью, агент уходит в архив (archived): сессия и подписка сохраняются,
 * любое новое сообщение возвращает его в работу с прежним контекстом.
 */
import type { AgentPlan, AgentStatus, AgentView, Message, PlanEntry, ReplyBrief, ToolBrief } from '../../../shared/types'
import { archiveAfterTurn, restoredStatus, statusAfterAttach, statusAfterTurn } from '../../domain/agent-status'
import { YOU } from '../../domain/constants'
import { pickPermissionOption } from '../../domain/permission'
import { coercePlanEntries, planOnTurnStart } from '../../domain/plan'
import { framePrompt } from '../../domain/routing'
import type { AgentIdentity, TurnOutcome } from '../../domain/types'
import { errMsg } from '../../lib/json'
import { clip, plainText } from '../../lib/text'
import type { PersistedAgent } from '../persisted.types'
import type { SessionEvent, SessionSubscription } from '../ports'
import { AgentJournal } from './agent-journal'
import type { AgentDeps, AgentInit, CurrentTurn, LiveRun, PendingPermission } from './agent.types'

export class Agent implements AgentIdentity {
	readonly id: string
	readonly name: string
	readonly space: string
	readonly parent: string
	/** id роли (роль могли удалить — id остаётся) */
	readonly role: string | null
	createdAt: string
	sessionId: string | null = null
	displayName: string | null = null
	lastEventId: number | null = null
	introduced = false
	status: AgentStatus
	error: string | null = null
	queue: Message[] = []
	lastActivityAt: string
	/** текст последнего ответа (для превью) */
	lastReply = ''
	/** план агента (сообщает сам: CLI или ACP `plan`) */
	plan: AgentPlan | null = null
	/** число вызовов инструментов в текущем (или последнем) ходе */
	turnSteps = 0
	/** длительность последнего завершённого хода, мс */
	lastTurnMs: number | null = null
	/** последний ответ оператору (you) */
	replyBrief: ReplyBrief | null = null
	/** скрыт из рабочего списка: задача выполнена, сессия сохранена */
	archived = false

	private readonly journal: AgentJournal
	private current: CurrentTurn | null = null
	private lastTool: ToolBrief | null = null
	private readonly pending = new Map<string, PendingPermission>()
	private sub: SessionSubscription | null = null
	private attaching: Promise<void> | null = null
	private pumping = false
	/** при следующем подключении сначала попробовать поднять прежнюю сессию (/load) */
	private resume = false
	/** сколько сообщений в начале очереди — срочные (доставляются раньше остальных, по порядку) */
	private urgent = 0
	private cancelTimer: NodeJS.Timeout | null = null
	/** отмена не подтверждена — события старого промпта игнорируем до ответа на следующий */
	private staleEvents = false
	/** promptId завершённых ходов (поздние turn_complete/cancelled по ним игнорируются) */
	private readonly donePrompts: string[] = []

	constructor(
		init: AgentInit,
		private readonly deps: AgentDeps,
		evSeq = 0,
	) {
		this.id = init.id
		this.name = init.name
		this.space = init.space
		this.parent = init.parent
		this.role = init.role ?? null
		this.status = init.status ?? 'starting'
		this.createdAt = this.isoNow()
		this.lastActivityAt = this.createdAt
		this.journal = new AgentJournal(init.id, deps, evSeq)
	}

	static restore(p: PersistedAgent, deps: AgentDeps): Agent {
		let evSeq = p.evSeq
		for (const e of deps.store.readEvents(p.id, 50)) if (e.seq > evSeq) evSeq = e.seq
		const a = new Agent({ id: p.id, name: p.name, space: p.space, parent: p.parent, role: p.role ?? null, status: restoredStatus() }, deps, evSeq)
		a.createdAt = p.createdAt
		a.sessionId = p.sessionId
		a.displayName = p.displayName
		a.lastEventId = p.lastEventId
		a.introduced = p.introduced
		a.queue = p.queue
		a.lastActivityAt = p.lastActivityAt
		a.lastReply = p.lastReply
		a.plan = p.plan ?? null
		a.turnSteps = p.turnSteps ?? 0
		a.lastTurnMs = p.lastTurnMs ?? null
		a.replyBrief = p.replyBrief ?? null
		a.archived = p.archived === true
		a.resume = p.sessionId !== null // сессия поднимется лениво, при первом сообщении
		return a
	}

	// ---------- представление ----------
	toJSON(): AgentView {
		return {
			id: this.id,
			name: this.name,
			space: this.space,
			parent: this.parent,
			role: this.role,
			status: this.status,
			archived: this.archived,
			error: this.error,
			displayName: this.displayName,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			queued: this.queue.length,
			turnStartedAt: this.current?.startedAt ?? null,
			lastTool: this.lastTool,
			preview: clip(this.current?.text || this.lastReply, 140),
			pendingPermissions: [...this.pending.values()].map(p => ({ requestId: p.requestId, title: p.title })),
			plan: this.plan,
			turnSteps: this.turnSteps,
			lastTurnMs: this.lastTurnMs,
			lastReply: this.replyBrief,
		}
	}

	persist(): PersistedAgent {
		return {
			id: this.id,
			name: this.name,
			space: this.space,
			parent: this.parent,
			role: this.role,
			archived: this.archived,
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
			plan: this.plan,
			turnSteps: this.turnSteps,
			lastTurnMs: this.lastTurnMs,
			replyBrief: this.replyBrief,
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

	/** nessy serve пространства упал: отцепиться и завершить ход с ошибкой; сессия поднимется при следующем сообщении. */
	onSpaceDown(reason: string): void {
		this.detach()
		this.resume = true
		this.finishTurn({ error: reason })
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

	// ---------- план ----------
	/** Заменить план целиком (null — убрать). Правила проверки — domain/plan.ts. */
	setPlan(entries: readonly PlanEntry[] | null, source: AgentPlan['source']): void {
		this.plan = entries && entries.length ? { entries: [...entries], updatedAt: this.isoNow(), source } : null
		this.touch()
		this.publishNode()
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
		const prev = this.resume ? this.sessionId : null
		const tryResume = prev !== null
		const resumed = prev !== null && (await client.resumeSession(prev, space.path))
		if (!resumed) {
			const hadSession = this.sessionId !== null
			const { sessionId } = await client.createSession(space.path)
			this.sessionId = sessionId
			this.lastEventId = null
			this.introduced = false // новый контекст — снова представиться
			if (hadSession)
				this.addSystem(
					tryResume ? 'сессию nessy не удалось восстановить — создана новая, контекст сброшен' : 'сессия nessy пересоздана, контекст сброшен',
				)
		}
		this.resume = false
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
		this.clearCancelTimer()
	}

	// ---------- архив ----------
	/** Убрать в архив или вернуть из него (проверки занятости — в сервисе). */
	setArchived(archived: boolean): void {
		if (this.archived === archived) return
		this.archived = archived
		this.publishNode()
	}

	// ---------- доставка сообщений ----------
	/**
	 * Доставить сообщение: агент выходит из архива. interrupt — срочно: встать впереди очереди
	 * (после других срочных) и прервать текущий ход.
	 */
	deliver(msg: Message, interrupt = false): void {
		this.archived = false
		if (interrupt) {
			this.queue.splice(this.urgent, 0, msg)
			this.urgent++
		} else {
			this.queue.push(msg)
		}
		this.publishNode()
		if (interrupt && this.current) {
			void this.requestCancel()
			return
		}
		void this.pump()
	}

	/** Продолжить доставку очереди (после восстановления из состояния). */
	resumeQueue(): void {
		if (this.queue.length) void this.pump()
	}

	private async pump(): Promise<void> {
		if (this.current || this.pumping) return
		if (!this.queue.length) return
		this.pumping = true
		try {
			await this.ensureAttached()
		} catch (e) {
			const failed = this.queue.splice(0)
			this.urgent = 0
			this.pumping = false
			for (const m of failed) this.noteReply(this.deps.host.onTurnDone(this, m, '', { error: errMsg(e) }))
			if (failed.length) this.publishNode()
			return
		}
		this.pumping = false
		if (this.isBusy) return
		const msg = this.queue.shift()
		if (!msg) return
		if (this.urgent > 0) this.urgent--

		this.current = { msg, promptId: null, text: '', startedAt: this.isoNow(), startedMs: this.deps.clock.now(), error: null, cancelRequested: false, sent: false }
		this.journal.resetTools()
		this.turnSteps = 0
		// новая задача от оператора после выполненного плана — план сбрасывается (уточнения его сохраняют)
		this.plan = planOnTurnStart(this.plan, msg.from === YOU, this.queue.length)
		this.setStatus('working')
		this.journal.add({ kind: 'user', from: msg.from, msgId: msg.id, text: msg.text })
		try {
			const client = this.deps.host.getSpace(this.space)?.client
			if (!client || !this.sessionId) throw new Error('нет соединения с nessy')
			const { promptId } = await client.prompt(this.sessionId, this.buildPrompt(msg))
			this.introduced = true
			const turn = this.turnFor(msg)
			if (turn) {
				this.staleEvents = false // nessy принял новый промпт — дальше события его
				turn.promptId = promptId
				turn.sent = true
				if (turn.cancelRequested) await this.sendCancel() // прервали, пока промпт летел в nessy
			}
		} catch (e) {
			if (this.turnFor(msg)) this.finishTurn({ error: errMsg(e) })
		}
	}

	/** Текущий ход, если он всё ещё по этому сообщению (ход мог завершиться, пока ждали nessy). */
	private turnFor(msg: Message): CurrentTurn | null {
		return this.current?.msg === msg ? this.current : null
	}

	private buildPrompt(msg: Message): string {
		const { host } = this.deps
		const body = framePrompt(msg, host.labelOf(msg.from))
		return this.introduced ? body : `${host.preambleFor(this)}\n\n${body}`
	}

	/** Прервать ход и очистить очередь. */
	async cancel(): Promise<void> {
		this.queue = []
		this.urgent = 0
		this.publishNode()
		await this.requestCancel()
	}

	/**
	 * Запросить отмену текущего хода. Ход завершится по событию nessy (cancelled/turn_complete);
	 * если подтверждения нет за cancelGraceMs — завершаем сами, а поздние события старого промпта игнорируем.
	 */
	private async requestCancel(): Promise<void> {
		const cur = this.current
		if (!cur || cur.cancelRequested) return
		cur.cancelRequested = true
		this.cancelTimer = setTimeout(() => {
			this.cancelTimer = null
			if (this.current !== cur) return
			this.staleEvents = true
			this.addSystem('nessy не подтвердил отмену — продолжаю без подтверждения')
			this.finishTurn({ stopReason: 'cancelled' })
		}, this.deps.cancelGraceMs)
		this.cancelTimer.unref()
		if (cur.sent) await this.sendCancel()
	}

	private async sendCancel(): Promise<void> {
		const client = this.deps.host.getSpace(this.space)?.client
		if (client && this.sessionId) await client.cancel(this.sessionId).catch(() => undefined)
	}

	private clearCancelTimer(): void {
		if (this.cancelTimer) clearTimeout(this.cancelTimer)
		this.cancelTimer = null
	}

	/** Это событие завершения относится к уже закрытому ходу (поздний кадр). */
	private isDonePrompt(promptId: string | null): boolean {
		return promptId !== null && this.donePrompts.includes(promptId)
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
		// после неподтверждённой отмены содержимое старого промпта не должно попасть в новый ход
		if (
			this.staleEvents &&
			(ev.kind === 'text' || ev.kind === 'thought' || ev.kind === 'tool' || ev.kind === 'turn_error' || ev.kind === 'permission' || ev.kind === 'plan')
		)
			return
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
				if (!this.current || this.isDonePrompt(ev.promptId)) return
				if (this.current.promptId && ev.promptId && this.current.promptId !== ev.promptId) return // устаревший реплей
				this.finishTurn({ stopReason: ev.stopReason })
				return
			case 'cancelled':
				if (!this.current || this.isDonePrompt(ev.promptId)) return
				if (this.current.promptId && ev.promptId && this.current.promptId !== ev.promptId) return
				this.finishTurn({ stopReason: 'cancelled' })
				return
			case 'plan':
				if (!this.current) return // реплей вне хода игнорируем: план мог смениться через CLI
				this.setPlan(coercePlanEntries(ev.entries), 'acp')
				return
			case 'followup':
				return // подсказки следующего вопроса оркестратору не нужны
			case 'died':
				// сессии больше нет: следующее сообщение создаст новую (контекст сброшен)
				this.detach()
				this.resume = false
				this.addSystem('сессия nessy завершилась: ' + ev.reason, 'error')
				if (this.current) this.finishTurn({ error: ev.reason })
				else this.setStatus('error', ev.reason)
				return
			case 'evicted':
				// nessy вытеснил сессию (лимит --max-sessions). Сразу переподключаемся, только если идёт ход:
				// иначе вытесненный агент вытеснит следующего — получится лавина newSession и таймауты
				// в nessy. Свободный агент поднимет сессию (/load) при следующем сообщении.
				this.detach()
				this.resume = true
				if (this.current) void this.ensureAttached().catch(() => undefined)
				return
		}
	}

	private onTool(ev: Extract<SessionEvent, { kind: 'tool' }>): void {
		// обновление инструмента, который мы не видели, вне хода — это реплей: пропускаем
		if (!this.current && !this.journal.hasTool(ev.toolId)) return
		const [rec, created] = this.journal.upsertTool(ev)
		this.touch()
		if (created) {
			this.turnSteps++
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
		this.lastTurnMs = Math.max(0, this.deps.clock.now() - cur.startedMs)
		this.clearCancelTimer()
		if (cur.promptId) {
			this.donePrompts.push(cur.promptId)
			if (this.donePrompts.length > 20) this.donePrompts.shift()
		}
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
		const queued = this.queue.length
		if (archiveAfterTurn(info, queued)) this.archived = true
		this.setStatus(statusAfterTurn(info, queued), info.error ?? null)
		if (this.noteReply(this.deps.host.onTurnDone(this, cur.msg, text, info))) this.publishNode()
		void this.pump()
	}

	/** Запомнить ответ оператору (you) для карточки агента. true — запомнили. */
	private noteReply(reply: Message | null): boolean {
		if (!reply || reply.to !== YOU) return false
		this.replyBrief = { msgId: reply.id, ts: reply.ts, preview: clip(plainText(reply.text), 200) }
		if (reply.failed) this.replyBrief.failed = reply.failed
		return true
	}
}
