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
 */
import type { AgentPlan, AgentStats, AgentStatus, AgentView, Message, PlanEntry, ReplyBrief, ToolBrief } from '../../../shared/types'
import { archiveAfterTurn, restoredStatus, statusAfterAttach, statusAfterTurn } from '../../domain/agent-status'
import { USER, YOU } from '../../domain/constants'
import { NessyBusyError } from '../../domain/errors'
import { pickPermissionOption } from '../../domain/permission'
import { coercePlanEntries, planOnTurnStart } from '../../domain/plan'
import { planReminder } from '../../domain/preamble'
import { parseReply } from '../../domain/reply'
import { urlsInInput } from '../../domain/sources'
import { framePrompt } from '../../domain/routing'
import type { AgentIdentity, TurnOutcome } from '../../domain/types'
import { errMsg } from '../../lib/json'
import { clip, plainText } from '../../lib/text'
import type { PersistedAgent } from '../persisted.types'
import { portEventToSessionEvent } from '../agent-port'
import type { AgentPort, Envelope, PortEvent, PortSubscription } from '../agent-port'
import type { SessionEvent } from '../ports'
import { AgentJournal } from './agent-journal'
import type { AgentDeps, AgentInit, CurrentTurn, LiveRun, PendingPermission } from './agent.types'

/** повторы промпта при временном отказе nessy: сколько раз и пауза */
const PROMPT_RETRY_MAX = 5
const PROMPT_RETRY_BASE_MS = 1000
const PROMPT_RETRY_MAX_DELAY_MS = 30000
/** повторы создания/подъёма сессии, пока у демона нет места (лимит сессий) */
const SESSION_RETRY_MAX = 12

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
	private current: CurrentTurn | null = null
	private lastTool: ToolBrief | null = null
	private readonly pending = new Map<string, PendingPermission>()
	private sub: PortSubscription | null = null
	private attaching: Promise<void> | null = null
	private pumping = false
	/** при следующем подключении сначала попробовать поднять прежнюю сессию (/load) */
	private resume = false
	/** сколько сообщений в начале очереди — срочные (доставляются раньше остальных, по порядку) */
	private urgent = 0
	private cancelTimer: NodeJS.Timeout | null = null
	private idleTimer: NodeJS.Timeout | null = null
	/** агент удаляется или удалён: новые сообщения отклоняются с ответом, очередь не обрабатывается */
	private removed = false
	/** идёт закрытие сессии nessy: поднимать её (/load) можно только после него */
	private closing: Promise<void> | null = null
	/** отмена не подтверждена — события старого промпта игнорируем до ответа на следующий */
	private staleEvents = false
	/** ход, который шёл в момент остановки оркестратора: ответа не будет (разбирается в resumeQueue) */
	private lostTurn: Message | null = null
	/** токены хода из turn_complete (если nessy их прислал) */
	/** заполнение контекста по GET /context-usage: занято и размер окна модели (оба от nessy, без значений по умолчанию) */
	private ctxUsed = 0
	private ctxSize = 0
	/** promptId завершённых ходов (поздние turn_complete/cancelled по ним игнорируются) */
	private readonly donePrompts: string[] = []
	/** повторы поручения после ошибки: какое сообщение, который по счёту повтор и последняя ошибка (для пометки в промпте) */
	private retryState: { id: string; n: number; error: string } | null = null
	/** пока идёт пауза перед повтором, очередь не разбирается */
	private holdPump = false

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
		this.createdAt = this.isoNow()
		this.lastActivityAt = this.createdAt
		this.journal = new AgentJournal(init.id, deps, evSeq)
	}

	static restore(p: PersistedAgent, deps: AgentDeps): Agent {
		let evSeq = p.evSeq
		for (const e of deps.store.readEvents(p.id, 50)) if (e.seq > evSeq) evSeq = e.seq
		const a = new Agent({ id: p.id, name: p.name, space: p.space, parent: p.parent, session: p.session ?? null, role: p.role ?? null, status: restoredStatus(), ...(p.key ? { key: p.key } : {}) }, deps, evSeq)
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
			stats: { ...this.stats, toolCalls: this.stats.toolCalls + (this.current ? this.turnSteps : 0), tokens: this.stats.tokens && { ...this.stats.tokens }, ...this.contextMetric() },
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
		if (this.current) this.finishTurn({ stopReason: 'cancelled' })
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
		this.plan = entries && entries.length ? { entries: [...entries], updatedAt: this.isoNow(), source } : null
		if (this.plan && this.current) this.current.planned = true
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
		const space = this.deps.callbacks.getSpace(this.space)
		if (!space) throw new Error(`пространство «${this.space}» не найдено`)
		const client = await space.ensureReady()
		await this.closing // сессию закрывали по простою: поднимать её можно только после закрытия
		const prev = this.resume ? this.nessyId : null
		// с какого события подписываться: у поднятой сессии — с последнего seq из ответа резюма (повтор истории не нужен), у новой — с начала
		let cursor = this.lastEventId
		let resumed = false
		if (prev !== null) {
			const r = await this.whenNessyFree(() => client.sessionResume(prev, space.path))
			if (r) {
				resumed = true
				cursor = r.lastSeq ?? cursor
			}
		}
		if (!resumed) {
			const hadSession = this.nessyId !== null
			// сначала заготовка из пула: создание сессии nessy — самая долгая часть запуска агента
			const warm = this.deps.callbacks.takeWarmSession(this.space)
			const sessionId = warm ?? (await this.whenNessyFree(() => client.sessionCreate(space.path))).sessionId
			this.nessyId = sessionId
			cursor = null
			this.lastEventId = null
			this.introduced = false // новый контекст — снова представиться
			if (hadSession)
				this.addSystem(prev !== null ? 'сессию nessy не удалось восстановить — создана новая, контекст сброшен' : 'сессия nessy пересоздана, контекст сброшен')
		}
		this.resume = false
		this.parked = false
		this.sub = client.subscribe(this.nessyId ?? '', {
			lastSeq: cursor,
			onEvent: envelope => this.onPortEvent(envelope),
		})
		const next = statusAfterAttach(this.status)
		if (next !== this.status) this.setStatus(next)
		else this.publishNode()
	}

	/**
	 * Вызов nessy, который при нехватке места (лимит сессий демона, 503) или гонке restore (409) стоит переждать:
	 * ждём Retry-After и повторяем несколько раз, агент остаётся «запускается».
	 */
	private async whenNessyFree<T>(fn: () => Promise<T>): Promise<T> {
		const base = this.deps.promptRetryBaseMs ?? PROMPT_RETRY_BASE_MS
		for (let attempt = 0; ; attempt++) {
			try {
				return await fn()
			} catch (e) {
				if (!(e instanceof NessyBusyError) || attempt >= SESSION_RETRY_MAX) throw e
				if (attempt === 0) this.addSystem(`nessy занят (${e.reason}) — жду свободное место`)
				await new Promise<void>(resolve => setTimeout(resolve, Math.min(e.retryAfterMs ?? base * 2 ** attempt, PROMPT_RETRY_MAX_DELAY_MS)).unref())
			}
		}
	}

	detach(): void {
		this.sub?.close()
		this.sub = null
		this.clearCancelTimer()
		this.clearIdleTimer()
	}

	// ---------- парковка по простою ----------
	private clearIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer)
		this.idleTimer = null
	}

	/** Свободного агента закроем через idleCloseMs. */
	private scheduleIdleClose(): void {
		this.clearIdleTimer()
		const ms = this.deps.idleCloseMs
		if (ms <= 0 || !this.sub || this.current || this.queue.length || this.pumping) return
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null
			void this.park()
		}, ms)
		this.idleTimer.unref()
	}

	/**
	 * Закрыть сессию nessy у свободного агента: подписка закрывается, DELETE освобождает слот демона, контекст остаётся на диске.
	 * Не трогаем агента, у которого есть ход, очередь или нерешённые запросы разрешений.
	 */
	async park(): Promise<void> {
		if (this.current || this.queue.length || this.pumping || this.pending.size || !this.sub || !this.nessyId) return
		const id = this.nessyId
		const client = this.deps.callbacks.getSpace(this.space)?.client
		this.detach()
		this.resume = true
		this.parked = true
		this.publishNode()
		if (!client) return
		this.closing = client
			.sessionClose(id)
			.catch(() => undefined)
			.finally(() => {
				this.closing = null
			})
		await this.closing
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
		if (this.removed) {
			this.noteReply(this.deps.callbacks.onTurnDone(this, msg, '', { error: 'агент удалён' }))
			return
		}
		this.archived = false
		this.clearIdleTimer()
		// работающему агенту сообщение не мешает: уходит в идущий ход (mid-turn-message); не приняли — встанет в очередь
		if (!interrupt && this.canInject()) {
			void this.inject(msg)
			return
		}
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

	private canInject(): boolean {
		const cur = this.current
		return cur !== null && cur.sent && !cur.cancelRequested && this.nessyId !== null && this.queue.length === 0
	}

	private async inject(msg: Message): Promise<void> {
		const turn = this.current
		const client = this.deps.callbacks.getSpace(this.space)?.client
		let ok = false
		if (turn && client && this.nessyId) ok = await client.midTurnSend(this.nessyId, framePrompt(msg, this.deps.callbacks.labelOf(msg.from))).catch(() => false)
		if (ok && this.current === turn && turn) {
			turn.injected.push({ msg, confirmed: false })
			this.touch()
			this.publishNode()
			return
		}
		// ход уже закончился или nessy не принял сообщение — обычная очередь
		this.queue.push(msg)
		this.publishNode()
		void this.pump()
	}

	/** Продолжить доставку очереди (после восстановления из состояния). */
	resumeQueue(): void {
		const lost = this.lostTurn
		if (lost) {
			// ход «в полёте» при остановке теряется: сообщаем об этом отправителю (в том числе ждущему --wait) и в чат
			this.lostTurn = null
			const reason = 'оркестратор был перезапущен во время хода'
			this.addSystem(`${reason}: ответа не будет`, 'error')
			this.setStatus('error', reason)
			this.noteReply(this.deps.callbacks.onTurnDone(this, lost, '', { error: reason }))
			this.publishNode()
		}
		if (this.queue.length) void this.pump()
	}

	private async pump(): Promise<void> {
		if (this.current || this.pumping || this.removed || this.holdPump) return
		if (!this.queue.length) return
		this.pumping = true
		try {
			await this.ensureAttached()
		} catch (e) {
			this.pumping = false
			// нет соединения с nessy: поручение повторяем с паузой, как и после ошибки хода
			const first = this.queue[0]
			const retry = first ? this.planRetry(first.id, errMsg(e), false) : null
			if (retry) {
				this.addSystem(`не удалось подключиться к nessy: ${errMsg(e)} — повтор ${retry.n}/${this.deps.turnRetries ?? 0} через ${Math.round(retry.delayMs / 1000)} с`, 'error')
				this.armRetry(retry.delayMs)
				return
			}
			const failed = this.queue.splice(0)
			this.urgent = 0
			for (const m of failed) this.noteReply(this.deps.callbacks.onTurnDone(this, m, '', { error: errMsg(e) }))
			if (failed.length) this.publishNode()
			return
		}
		this.pumping = false
		if (this.isBusy) return
		const msg = this.queue.shift()
		if (!msg) return
		if (this.urgent > 0) this.urgent--

		this.current = {
			msg,
			promptId: null,
			texts: [],
			textMsgId: null,
			textBreak: false,
			planned: false,
			planWarned: false,
			startedAt: this.isoNow(),
			startedMs: this.deps.clock.now(),
			error: null,
			cancelRequested: false,
			sent: false,
			injected: [],
		}
		this.journal.resetTools()
		this.turnSteps = 0
		// новая сессия от оператора после выполненного плана — план сбрасывается (уточнения его сохраняют)
		this.plan = planOnTurnStart(this.plan, msg.from === YOU || msg.from === USER, this.queue.length)
		this.setStatus('working')
		this.journal.add({ kind: 'user', from: msg.from, msgId: msg.id, text: msg.text })
		try {
			const client = this.deps.callbacks.getSpace(this.space)?.client
			if (!client || !this.nessyId) throw new Error('нет соединения с nessy')
			const { promptId } = await this.promptWithRetry(client, this.nessyId, msg)
			this.introduced = true
			const turn = this.turnFor(msg)
			if (!turn) {
				// ход закрыли (отмена без подтверждения, удаление), пока промпт летел: nessy его всё же принял — его события игнорируем, а сам он отменяется
				if (promptId) this.rememberDone(promptId)
				void this.sendCancel()
				return
			}
			this.staleEvents = false // nessy принял новый промпт — дальше события его
			turn.promptId = promptId
			turn.sent = true
			if (turn.cancelRequested) await this.sendCancel() // прервали, пока промпт летел в nessy
		} catch (e) {
			if (this.turnFor(msg)) this.finishTurn({ error: errMsg(e) })
		}
	}

	/**
	 * Отправить промпт; на временный отказ nessy (очередь переполнена, 429, сессия занята) ждём и повторяем
	 * с растущей паузой (или Retry-After), пока ход не отменили. Окончательная ошибка пробрасывается.
	 */
	private async promptWithRetry(client: AgentPort, sessionId: string, msg: Message): Promise<{ promptId: string | null }> {
		const base = this.deps.promptRetryBaseMs ?? PROMPT_RETRY_BASE_MS
		for (let attempt = 0; ; attempt++) {
			try {
				return await client.promptSend(sessionId, this.buildPrompt(msg))
			} catch (e) {
				const cur = this.turnFor(msg)
				if (!(e instanceof NessyBusyError) || attempt >= PROMPT_RETRY_MAX || !cur || cur.cancelRequested) throw e
				const delay = Math.min(e.retryAfterMs ?? base * 2 ** attempt, PROMPT_RETRY_MAX_DELAY_MS)
				if (attempt === 0) this.addSystem(`nessy занят (${e.reason}) — повторю отправку`)
				await new Promise<void>(resolve => setTimeout(resolve, delay).unref())
			}
		}
	}

	/** Текущий ход, если он всё ещё по этому сообщению (ход мог завершиться, пока ждали nessy). */
	private turnFor(msg: Message): CurrentTurn | null {
		return this.current?.msg === msg ? this.current : null
	}

	private buildPrompt(msg: Message): string {
		const callbacks = this.deps.callbacks
		let body = framePrompt(msg, callbacks.labelOf(msg.from))
		// повтор после ошибки: модель знает, что предыдущая попытка оборвалась, и не повторяет уже сделанное
		if (this.retryState?.id === msg.id) {
			body = `[nessy-orch] Прошлая попытка выполнить это поручение оборвалась ошибкой: «${clip(this.retryState.error, 300)}». Продолжи с того места, где остановился. Уже выполненные действия (особенно записи во внешние системы: комментарии, правки, коммиты) не повторяй: сначала проверь текущее состояние.\n\n${body}`
		}
		// правила плана — в вводной первого промпта; напоминание повторяем только там: у агентов малое окно контекста, каждая строка в каждом ходе копится
		return this.introduced ? body : `${callbacks.preambleFor(this)}\n\n${body}\n\n${planReminder(this.id, this.deps.cliPath, this.deps.showKey ? this.key : undefined)}`
	}

	/** Прервать ход и очистить очередь. */
	async cancel(): Promise<void> {
		// сброшенные сообщения (очередь и не забранные моделью mid-turn): отправителей, которые ждут ответа (--wait), не оставляем до таймаута
		const dropped = [...this.queue, ...(this.current?.injected.filter(i => !i.confirmed).map(i => i.msg) ?? [])]
		this.queue = []
		this.urgent = 0
		if (this.holdPump) {
			// шла пауза перед повтором: поручение отменено, повторять нечего
			this.holdPump = false
			this.retryState = null
			if (!this.current) this.setStatus('idle')
		}
		if (this.current) this.current.injected = this.current.injected.filter(i => i.confirmed)
		for (const m of dropped) if (m.wait) this.noteReply(this.deps.callbacks.onTurnDone(this, m, '', { stopReason: 'cancelled' }))
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
		const client = this.deps.callbacks.getSpace(this.space)?.client
		if (client && this.nessyId) await client.promptCancel(this.nessyId).catch(() => undefined)
	}

	private clearCancelTimer(): void {
		if (this.cancelTimer) clearTimeout(this.cancelTimer)
		this.cancelTimer = null
	}

	private rememberDone(promptId: string): void {
		this.donePrompts.push(promptId)
		if (this.donePrompts.length > 20) this.donePrompts.shift()
	}

	/** Это событие завершения относится к уже закрытому ходу (поздний кадр). */
	private isDonePrompt(promptId: string | null): boolean {
		return promptId !== null && this.donePrompts.includes(promptId)
	}

	async close(): Promise<void> {
		this.detach()
		const client = this.deps.callbacks.getSpace(this.space)?.client
		if (client && this.nessyId) await client.sessionClose(this.nessyId)
	}

	// ---------- события порта ----------
	/** Событие порта: Envelope → SessionEvent (нормализация §3), seq конверта идёт как eventId (для lastEventId). */
	private onPortEvent(envelope: Envelope): void {
		// конверт несёт событие порта, разбитое на type + data; порт гарантирует контрактную форму
		const portEvent: { type: string; data: unknown } = { type: envelope.type, data: envelope.data }
		const ev = portEventToSessionEvent(portEvent as PortEvent)
		if (ev) this.onSessionEvent(ev, envelope.seq ?? null)
	}

	// ---------- события nessy ----------
	private onSessionEvent(ev: SessionEvent, eventId: number | null): void {
		if (eventId !== null) {
			this.lastEventId = eventId
			this.deps.callbacks.saveSoon()
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
				if (ev.kind === 'text') this.appendText(ev.text, ev.messageId)
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
			case 'injected': {
				// nessy забрал сообщения mid-turn: модель их увидела (подтверждаем по порядку)
				let n = ev.count
				for (const i of this.current?.injected ?? []) {
					if (n > 0 && !i.confirmed) {
						i.confirmed = true
						n--
						// в чат — когда модель сообщение действительно увидела
						this.journal.add({ kind: 'user', from: i.msg.from, msgId: i.msg.id, text: i.msg.text })
						this.touch()
					}
				}
				return
			}
			case 'died':
				// сессии больше нет: следующее сообщение создаст новую (контекст сброшен)
				this.detach()
				this.resume = false
				this.addSystem('сессия nessy завершилась: ' + ev.reason, 'error')
				if (this.current) this.finishTurn({ error: ev.reason })
				else this.setStatus('error', ev.reason)
				return
			case 'resync':
				// пропущенные события могли включать конец хода: ход закрываем с ошибкой (а в nessy отменяем), сессию подписываем заново
				this.detach()
				this.resume = true
				if (this.current) {
					void this.sendCancel()
					this.finishTurn({ error: 'события nessy потеряны (переполнение кольца) — ход прерван' })
				}
				void this.ensureAttached().catch(() => undefined)
				return
			case 'evicted':
				this.detach()
				this.resume = true
				void this.ensureAttached().catch(() => undefined)
				return
			case 'usage':
				// расход контекста из события порта (вместо опроса /stats): used — занято в окне, size — окно модели
				this.ctxUsed = ev.used
				this.ctxSize = ev.size
				if (ev.used > 0) this.stats = { ...this.stats, tokens: { input: 0, output: 0, cached: 0, total: ev.used }, ...this.contextMetric() }
				this.publishNode()
				return
			case 'closed':
				// сессия закрыта рантаймом: подписка мертва, следующее сообщение создаст новую сессию
				this.detach()
				this.resume = true
				return
		}
	}

	private onTool(ev: Extract<SessionEvent, { kind: 'tool' }>): void {
		// обновление инструмента, который мы не видели, вне хода — это реплей: пропускаем
		if (!this.current && !this.journal.hasTool(ev.toolId)) return
		const [rec, created] = this.journal.upsertTool(ev)
		this.touch()
		const urls = urlsInInput(rec.input)
		if (urls.length) this.deps.callbacks.onToolUrls(this, urls)
		if (created) {
			this.turnSteps++
			this.lastTool = { name: rec.name, title: clip(rec.title || JSON.stringify(rec.input), 120) }
			if (this.current) {
				this.current.textBreak = true
				this.checkPlan(this.current)
			}
			this.publishNode()
		}
	}

	/** Текст хода по блокам: новый блок — при смене messageId или после вызова инструмента. */
	private appendText(delta: string, messageId: string | null): void {
		const cur = this.current
		if (!cur) return
		const fresh = !cur.texts.length || cur.textBreak || (messageId !== null && cur.textMsgId !== null && messageId !== cur.textMsgId)
		if (fresh) cur.texts.push(delta)
		else cur.texts.push((cur.texts.pop() ?? '') + delta)
		cur.textBreak = false
		cur.textMsgId = messageId ?? cur.textMsgId
	}

	/** После 3+ инструментов без плана в этом ходе — одно предупреждение в ленте агента. */
	private checkPlan(cur: CurrentTurn): void {
		if (cur.planned || cur.planWarned || this.turnSteps < 3) return
		cur.planWarned = true
		this.addSystem('агент не опубликовал план')
	}

	private onPermission(ev: Extract<SessionEvent, { kind: 'permission' }>): void {
		const title = clip(ev.title, 200)
		if (this.deps.autoApprove) {
			const client = this.deps.callbacks.getSpace(this.space)?.client
			const optionId = pickPermissionOption(ev.options, true)
			if (client && this.nessyId) void client.permissionVote(this.nessyId, ev.requestId, optionId).catch(() => undefined)
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
		const client = this.deps.callbacks.getSpace(this.space)?.client
		if (!p || !client || !this.nessyId) return false
		await client.permissionVote(this.nessyId, requestId, pickPermissionOption(p.options, approve))
		this.pending.delete(requestId)
		this.journal.add({ kind: 'permission', requestId, title: p.title, resolved: true, approved: approve, auto: false })
		this.touch()
		this.publishNode()
		return true
	}

	/** Размер контекста по входным токенам последнего хода: растёт вместе с историей чата агента (usage.input — весь промпт хода). */
	private contextMetric(): Pick<AgentStats, 'contextTokens' | 'contextPct'> {
		if (this.ctxUsed <= 0 || this.ctxSize <= 0) return { contextTokens: this.stats.contextTokens ?? null, contextPct: this.stats.contextPct ?? null }
		return { contextTokens: this.ctxUsed, contextPct: Math.round((this.ctxUsed / this.ctxSize) * 100) }
	}

	private finishTurn(outcome: TurnOutcome): void {
		const cur = this.current
		if (!cur) return
		this.current = null
		this.lastTurnMs = Math.max(0, this.deps.clock.now() - cur.startedMs)
		this.stats = {
			turns: this.stats.turns + 1,
			toolCalls: this.stats.toolCalls + this.turnSteps,
			workMs: this.stats.workMs + this.lastTurnMs,
			tokens: this.stats.tokens,
			...this.contextMetric(),
		}
		this.clearCancelTimer()
		if (cur.promptId) this.rememberDone(cur.promptId)
		this.journal.flushRun()
		const info: TurnOutcome = { ...outcome }
		if (!info.error && cur.error) info.error = cur.error
		const cancelled = info.stopReason === 'cancelled'
		if (info.error || cancelled) this.journal.failOpenTools()
		// запросы разрешений, не решённые до конца хода, больше не актуальны
		this.pending.clear()
		// результат хода — только финальное сообщение: последний непустой блок текста
		const text = finalText(cur.texts)
		if (text) this.lastReply = text
		// ошибка хода: повторяем то же поручение (2 раза с растущей паузой), ответ с ошибкой — только когда повторы кончились
		const retry = this.planRetry(cur.msg.id, info.error, cancelled || cur.cancelRequested)
		if (info.error) this.addSystem('ход завершился ошибкой: ' + info.error + (retry ? ` — повтор ${retry.n}/${this.deps.turnRetries ?? 0} через ${Math.round(retry.delayMs / 1000)} с` : ''), 'error')
		else if (cancelled) this.addSystem('ход прерван')
		if (!info.error) this.retryState = null
		if (retry) {
			this.holdRetry(cur, retry.delayMs)
			return
		}
		const queued = this.queue.length
		if (archiveAfterTurn(info, queued)) this.archived = true
		this.setStatus(statusAfterTurn(info, queued), info.error ?? null)
		if (this.noteReply(this.deps.callbacks.onTurnDone(this, cur.msg, text, info))) this.publishNode()
		// сообщения, доставленные в ход без прерывания: тому же отправителю отдельный ответ не нужен, остальным (и ждущим --wait) — нужен
		const unseen: Message[] = []
		for (const { msg: m, confirmed } of cur.injected) {
			if (!confirmed) unseen.push(m) // ход закончился раньше, чем nessy забрал сообщение: модель его не видела
			else if (m.from !== cur.msg.from || m.wait) this.noteReply(this.deps.callbacks.onTurnDone(this, m, text, info))
		}
		if (unseen.length) {
			this.queue.splice(this.urgent, 0, ...unseen) // после срочных, но раньше обычной очереди
			this.publishNode()
		}
		void this.pump()
		this.scheduleIdleClose()
	}

	/** Нужен ли повтор: любая ошибка (кроме отмены), агент жив и повторы не исчерпаны. */
	private planRetry(msgId: string, error: string | undefined, noRetry: boolean): { n: number; delayMs: number } | null {
		const max = this.deps.turnRetries ?? 0
		if (!error || noRetry || this.removed || max <= 0) return null
		const n = (this.retryState?.id === msgId ? this.retryState.n : 0) + 1
		if (n > max) {
			this.retryState = null
			return null
		}
		this.retryState = { id: msgId, n, error }
		return { n, delayMs: (this.deps.turnRetryBaseMs ?? 3000) * 2 ** (n - 1) }
	}

	/** Вернуть поручение в начало очереди и разобрать её после паузы; сообщения, доставленные в тот же ход, идут следом. */
	private holdRetry(cur: CurrentTurn, delayMs: number): void {
		this.queue.unshift(cur.msg)
		this.urgent++
		this.queue.splice(this.urgent, 0, ...cur.injected.map(i => i.msg))
		this.armRetry(delayMs)
	}

	/** Пауза перед повтором: очередь не разбирается, агент считается работающим. */
	private armRetry(delayMs: number): void {
		this.holdPump = true
		this.setStatus('working')
		this.publishNode()
		setTimeout(() => {
			this.holdPump = false
			void this.pump()
		}, delayMs).unref()
	}

	/** Запомнить ответ оператору (you) для карточки агента. true — запомнили. */
	private noteReply(reply: Message | null): boolean {
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

/** Последний непустой блок текста хода (промежуточные комментарии между инструментами в ответ не входят). */
function finalText(texts: readonly string[]): string {
	for (let i = texts.length - 1; i >= 0; i--) {
		const t = (texts[i] ?? '').trim()
		if (t) return t
	}
	return ''
}
