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
 *
 * Простаивающего агента (после хода, без очереди и запросов разрешений) через idleCloseMs «паркуем»: подписка закрывается, сессия nessy
 * закрывается (DELETE — слот демона свободен, контекст остаётся на диске). Следующее сообщение поднимает её через /load и подписывается
 * с lastEventId из ответа (без повтора истории). Сообщение работающему агенту по умолчанию не прерывает его, а доставляется в идущий ход
 * (mid-turn-message); не приняли — встаёт в очередь.
 *
 * Поведение разнесено по подсистемам (единая ответственность): подключение — agent-connection.ts,
 * очередь/ход — agent-turn.ts, события/usage — agent-events.ts. Здесь — состояние, представление и якорные мутаторы.
 */
import type { AgentPlan, AgentStats, AgentStatus, AgentView, Message, PlanEntry, ReplyBrief, ToolBrief } from '../../../shared/types'
import { restoredStatus } from '../../domain/agent-status'
import { USER, YOU } from '../../domain/constants'
import { parseReply } from '../../domain/reply'
import type { AgentIdentity } from '../../domain/types'
import { clip, plainText } from '../../lib/text'
import type { Envelope, PortSubscription } from '../agent-port'
import type { PersistedAgent } from '../persisted.types'
import { ensureAttached as ensureAttachedFn, detach as detachFn, park as parkFn, scheduleIdleClose as scheduleIdleCloseFn } from './agent-connection'
import { processPortEvent, resolvePermission as resolvePermissionFn } from './agent-events'
import { AgentJournal } from './agent-journal'
import type { AgentDeps, AgentInit, AgentState, CurrentTurn, LiveRun, PendingPermission } from './agent.types'
import { cancel as cancelFn, deliver as deliverFn, finishTurn as finishTurnFn, resumeQueue as resumeQueueFn } from './agent-turn'

export class Agent implements AgentIdentity {
	readonly id: string
	readonly name: string
	readonly space: string
	readonly parent: string
	/** id сессии (null — вне сессий); сбрасывается при удалении сессии */
	session: string | null
	/** id роли (роль могли удалить — id остаётся) */
	readonly role: string | null
	/** секретный ключ: подтверждает, что команду от имени агента (`--from`) выполняет он сам; в AgentView не попадает */
	readonly key: string
	createdAt: string
	/** id сессии nessy (не путать с сессией оркестратора — `session`) */
	nessyId: string | null = null
	displayName: string | null = null
	/** короткий заголовок от запустившего (поручение — отдельно) */
	title: string | null = null
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
	/** скрыт из рабочего списка: сессия выполнена, сессия сохранена */
	archived = false
	/** сессия nessy закрыта по простою (контекст на диске); поднимается при следующем сообщении */
	parked = false
	/** счётчики работы агента (ходы, инструменты, время, токены) */
	stats: AgentStats = { turns: 0, toolCalls: 0, workMs: 0, tokens: null }

	private readonly journal: AgentJournal
	current: CurrentTurn | null = null
	lastTool: ToolBrief | null = null
	private readonly pending = new Map<string, PendingPermission>()
	sub: PortSubscription | null = null
	attaching: Promise<void> | null = null
	pumping = false
	/** при следующем подключении сначала попробовать поднять прежнюю сессию (/load) */
	resume = false
	/** сколько сообщений в начале очереди — срочные (доставляются раньше остальных, по порядку) */
	urgent = 0
	cancelTimer: NodeJS.Timeout | null = null
	idleTimer: NodeJS.Timeout | null = null
	/** агент удаляется или удалён: новые сообщения отклоняются с ответом, очередь не обрабатывается */
	removed = false
	/** идёт закрытие сессии nessy: поднимать её (/load) можно только после него */
	closing: Promise<void> | null = null
	/** отмена не подтверждена — события старого промпта игнорируем до ответа на следующий */
	staleEvents = false
	/** ход, который шёл в момент остановки оркестратора: ответа не будет (разбирается в resumeQueue) */
	lostTurn: Message | null = null
	/** заполнение контекста по событию usage: занято и размер окна модели (оба от nessy, без значений по умолчанию) */
	ctxUsed = 0
	ctxSize = 0
	/** promptId завершённых ходов (поздние turn_complete/cancelled по ним игнорируются) */
	private readonly donePrompts: string[] = []
	/** повторы поручения после ошибки: какое сообщение, который по счёту повтор и последняя ошибка (для пометки в промпте) */
	retryState: { id: string; n: number; error: string } | null = null
	/** пока идёт пауза перед повтором, очередь не разбирается */
	holdPump = false
	/** вход событий порта (Envelope → обработка) — ставит подключение при подписке на сессию */
	handlePortEvent: (envelope: Envelope) => void = envelope => this.onPortEvent(envelope)

	constructor(
		init: AgentInit,
		private readonly deps: AgentDeps,
		evSeq = 0,
	) {
		this.id = init.id
		this.name = init.name
		this.space = init.space
		this.parent = init.parent
		this.session = init.session ?? null
		this.role = init.role ?? null
		this.key = init.key ?? deps.newKey()
		this.status = init.status ?? 'starting'
		this.createdAt = new Date(this.deps.clock.now()).toISOString()
		this.lastActivityAt = this.createdAt
		this.journal = new AgentJournal(init.id, deps, evSeq)
	}

	static restore(p: PersistedAgent, deps: AgentDeps): Agent {
		let evSeq = p.evSeq
		for (const e of deps.store.readEvents(p.id, 50)) if (e.seq > evSeq) evSeq = e.seq
		const a = new Agent(
			{
				id: p.id,
				name: p.name,
				space: p.space,
				parent: p.parent,
				session: p.session ?? null,
				role: p.role ?? null,
				status: restoredStatus(),
				...(p.key ? { key: p.key } : {}),
			},
			deps,
			evSeq,
		)
		// агент из состояния без ключа получает новый и снова «представляется» (вводная содержит ключ)
		if (!p.key) a.introduced = false
		a.createdAt = p.createdAt
		a.nessyId = p.sessionId
		a.displayName = p.displayName
		a.title = p.title ?? null
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
		a.parked = p.parked === true
		if (p.stats) a.stats = { ...p.stats }
		a.lostTurn = p.inflight ?? null
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
			session: this.session,
			role: this.role,
			status: this.status,
			archived: this.archived,
			parked: this.parked,
			error: this.error,
			displayName: this.displayName,
			title: this.title,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			queued: this.queue.length,
			turnStartedAt: this.current?.startedAt ?? null,
			lastTool: this.lastTool,
			preview: clip(this.current?.texts.at(-1) || this.lastReply, 140),
			pendingPermissions: [...this.pending.values()].map(p => ({ requestId: p.requestId, title: p.title })),
			plan: this.plan,
			turnSteps: this.turnSteps,
			lastTurnMs: this.lastTurnMs,
			lastReply: this.replyBrief,
			// на лету: вызовы идущего хода и заполнение контекста — карточка живая, а не обновляется раз за ход
			stats: {
				...this.stats,
				toolCalls: this.stats.toolCalls + (this.current ? this.turnSteps : 0),
				tokens: this.stats.tokens && { ...this.stats.tokens },
				...this.contextMetric(),
			},
		}
	}

	persist(): PersistedAgent {
		return {
			id: this.id,
			name: this.name,
			space: this.space,
			parent: this.parent,
			session: this.session,
			role: this.role,
			archived: this.archived,
			parked: this.parked,
			key: this.key,
			createdAt: this.createdAt,
			sessionId: this.nessyId,
			displayName: this.displayName,
			title: this.title,
			lastEventId: this.lastEventId,
			introduced: this.introduced,
			status: this.status,
			error: this.error,
			// не забранные моделью сообщения mid-turn при рестарте не теряются: после потерянного хода они уйдут обычными промптами
			queue: [...(this.current?.injected.filter(i => !i.confirmed).map(i => i.msg) ?? []), ...this.queue],
			evSeq: this.journal.evSeq,
			lastActivityAt: this.lastActivityAt,
			lastReply: this.lastReply,
			plan: this.plan,
			turnSteps: this.turnSteps,
			lastTurnMs: this.lastTurnMs,
			replyBrief: this.replyBrief,
			stats: this.stats,
			inflight: this.current?.msg ?? null,
		}
	}

	get isBusy(): boolean {
		return this.current !== null
	}

	/** Сообщение, которое агент обрабатывает сейчас (для расчёта hops). */
	get currentMessage(): Message | null {
		return this.current?.msg ?? null
	}

	/** Незавершённый блок текста (для снапшота при подключении клиента). */
	liveRun(): LiveRun | null {
		return this.journal.liveRun()
	}

	/** Агент недоступен (его пространство пропало): остаётся в списке с причиной, чат и ответы не теряются. */
	markLost(reason: string): void {
		this.setStatus('error', reason)
		this.addSystem(reason, 'error')
	}

	/** Агент удаляется посреди хода: ход закрывается как прерванный, чтобы ждавшие его ответа получили «(ход прерван)», а не таймаут. */
	forceFinish(): void {
		this.removed = true
		this.clearCancelTimer()
		if (this.current) finishTurnFn(this as unknown as AgentState, { stopReason: 'cancelled' })
	}

	/** nessy serve пространства упал: отцепиться и завершить ход с ошибкой; сессия поднимется при следующем сообщении. */
	onSpaceDown(reason: string): void {
		this.detach()
		this.resume = true
		finishTurnFn(this as unknown as AgentState, { error: reason })
	}

	private touch(): void {
		this.lastActivityAt = new Date(this.deps.clock.now()).toISOString()
	}

	private setStatus(status: AgentStatus, error: string | null = null): void {
		this.status = status
		this.error = error
		this.touch()
		this.publishNode()
	}

	/** Перепривязать к сессии (null — вне сессий) и опубликовать узел. */
	setSession(session: string | null): void {
		if (this.session === session) return
		this.session = session
		this.publishNode()
	}

	publishNode(): void {
		this.deps.hub.publish({ t: 'agent', agent: this.toJSON() })
		this.deps.callbacks.saveSoon()
	}

	addSystem(text: string, level: 'info' | 'error' = 'info'): void {
		this.journal.add({ kind: 'system', level, text })
		this.touch()
	}

	// ---------- план ----------
	/** Заменить план целиком (null — убрать). Правила проверки — domain/plan.ts. */
	setPlan(entries: readonly PlanEntry[] | null, source: AgentPlan['source']): void {
		this.plan = entries && entries.length ? { entries: [...entries], updatedAt: new Date(this.deps.clock.now()).toISOString(), source } : null
		if (this.plan && this.current) this.current.planned = true
		this.touch()
		this.publishNode()
	}

	// ---------- подключение к nessy ----------
	/** Подключить агента: создать (или поднять) сессию и подписаться на события. */
	ensureAttached(): Promise<void> {
		return ensureAttachedFn(this as unknown as AgentState)
	}

	detach(): void {
		detachFn(this as unknown as AgentState)
	}

	// ---------- парковка по простою ----------
	clearIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer)
		this.idleTimer = null
	}

	/** Свободного агента закроем через idleCloseMs. */
	scheduleIdleClose(): void {
		scheduleIdleCloseFn(this as unknown as AgentState)
	}

	/** Закрыть сессию nessy у свободного агента: подписка закрывается, DELETE освобождает слот демона, контекст остаётся на диске. */
	park(): Promise<void> {
		return parkFn(this as unknown as AgentState)
	}

	// ---------- архив ----------
	/** Убрать в архив или вернуть из него (проверки занятости — в сервисе). */
	setArchived(archived: boolean): void {
		if (this.archived === archived) return
		this.archived = archived
		this.publishNode()
	}

	// ---------- доставка сообщений ----------
	/** Доставить сообщение: агент выходит из архива. interrupt — срочно: встать впереди очереди и прервать текущий ход. */
	deliver(msg: Message, interrupt = false): void {
		deliverFn(this as unknown as AgentState, msg, interrupt)
	}

	/** Продолжить доставку очереди (после восстановления из состояния). */
	resumeQueue(): void {
		resumeQueueFn(this as unknown as AgentState)
	}

	/** Прервать ход и очистить очередь. */
	async cancel(): Promise<void> {
		return cancelFn(this as unknown as AgentState)
	}

	private clearCancelTimer(): void {
		if (this.cancelTimer) clearTimeout(this.cancelTimer)
		this.cancelTimer = null
	}

	rememberDone(promptId: string): void {
		this.donePrompts.push(promptId)
		if (this.donePrompts.length > 20) this.donePrompts.shift()
	}

	/** Это событие завершения относится к уже закрытому ходу (поздний кадр). */
	isDonePrompt(promptId: string | null): boolean {
		return promptId !== null && this.donePrompts.includes(promptId)
	}

	async close(): Promise<void> {
		this.detach()
		const client = this.deps.callbacks.getSpace(this.space)?.client
		if (client && this.nessyId) await client.sessionClose(this.nessyId)
	}

	// ---------- события порта ----------
	/** Событие порта: Envelope → SessionEvent (нормализация §3), обработка — в agent-events.ts. */
	private onPortEvent(envelope: Envelope): void {
		processPortEvent(this as unknown as AgentState, envelope)
	}

	async resolvePermission(requestId: string, approve: boolean): Promise<boolean> {
		return resolvePermissionFn(this as unknown as AgentState, requestId, approve)
	}

	/** Размер контекста по входным токенам последнего хода: растёт вместе с историей чата агента (usage.input — весь промпт хода). */
	private contextMetric(): Pick<AgentStats, 'contextTokens' | 'contextPct'> {
		if (this.ctxUsed <= 0 || this.ctxSize <= 0) return { contextTokens: this.stats.contextTokens ?? null, contextPct: this.stats.contextPct ?? null }
		return { contextTokens: this.ctxUsed, contextPct: Math.round((this.ctxUsed / this.ctxSize) * 100) }
	}

	/** Запомнить ответ оператору (you) для карточки агента. true — запомнили. */
	noteReply(reply: Message | null): boolean {
		if (!reply || (reply.to !== YOU && reply.to !== USER)) return false
		this.replyBrief = { msgId: reply.id, ts: reply.ts, preview: clip(plainText(reply.text), 200) }
		const status = reply.failed ? null : parseReply(reply.text).status
		if (status) {
			this.replyBrief.status = status.code
			if (status.reason) this.replyBrief.reason = status.reason
		}
		if (reply.failed) this.replyBrief.failed = reply.failed
		return true
	}
}
