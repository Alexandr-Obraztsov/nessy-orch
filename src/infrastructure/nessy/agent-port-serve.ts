/**
 * NessyServeAdapter — реализация AgentPort поверх существующего NessyGateway (nessy-client.ts + event-mapper.ts).
 * Путь отката при проблемах с новыми адаптерами (§6а дизайна). Оборачивает транспорт nessy, не меняя его поведение:
 * операции пробрасываются в NessyGateway, события SessionEvent переводятся в Envelope(PortEvent) и получают
 * сквозные seq/ts/originatorClientId.
 *
 * Синтез обязательных core-событий (§3 «Правило происхождения»): nessy не шлёт turn.started / message.completed /
 * session.ready / session.closed, поэтому адаптер синтезирует их из собственных действий, не трогая нативный поток:
 *  - session.ready  — на первой подписке после успешного sessionCreate/sessionResume;
 *  - turn.started   — на promptSend ПОСЛЕ успешной постановки промпта (при ошибке постановки — turn.failed);
 *  - message.completed — на turn.completed, если за ход был текст (message.delta копится по сессии);
 *  - session.closed — на sessionClose.
 *
 * seq: Envelope.seq — всегда единый монотонный per-session счётчик адаптера (и для нативных, и для синтезированных
 * событий). Транспортный eventId nessy хранится отдельно (adapterToTransport) и используется только внутри для
 * резюма: subscribe(lastSeq) переводит lastSeq → транспортный Last-Event-ID; sessionResume возвращает lastSeq
 * в adapter-space (транспортный id наружу не уходит). Так seq наружу монотонен и уникален, а resume работает от
 * транспортного id.
 *
 * Парность хода: turn.started → (turn.completed | turn.failed | turn.cancelled). При обрыве транспорта посреди хода
 * (died/evicted/resync) и при sessionClose открытый ход закрывается синтезированным терминалом, чтобы потребитель
 * не завис в ожидании.
 *
 * Capabilities: setModel=false — в NessyGateway операции смены модели нет; остальные три — поддерживаются.
 * Адаптер в рантайме ядра не используется (ядро работает с NessyClient напрямую) — он аддитивен и не влияет на поведение.
 */
import type { AgentPort, Capabilities, Envelope, PortEvent, PortEventListener, PortSubscription, PortSubscribeOptions } from '../../application/agent-port'
import { sessionEventToPortEvent } from '../../application/agent-port'
import type { Clock, NessyGateway, SessionEvent } from '../../application/ports'
import { AppError, NessyBusyError } from '../../domain/errors'
import { errMsg } from '../../lib/json'

export interface NessyServeAdapterOptions {
	/** HTTP/SSE-клиент одного nessy serve (NessyClient). */
	client: NessyGateway
	/** воркспейс, в котором создаются сессии (путь пространства). */
	cwd: string
	/** часы для ts событий (по умолчанию Date.now). */
	clock?: Clock
	/** идентификатор клиента-происхождения (null — не указан). */
	originatorClientId?: string | null
}

/** Состояние синтеза по сессии: накопленный текст, счётчик seq, маппинг seq↔transport, готовность и открытый ход. */
interface SessionSynth {
	id: string
	ready: boolean
	text: string
	subscriber: PortEventListener | null
	/** монотонный per-session счётчик для Envelope.seq */
	seq: number
	/** adapterSeq → транспортный eventId (для нативных событий); нужен для резюма. */
	adapterToTransport: Map<number, number>
	/** последний транспортный id из restoreSession (для резюма, когда mapping ещё пуст). */
	resumeTransportId: number | null
	/** открыт ли ход (turn.started уже эмичен и нет терминала). */
	turnOpen: boolean
}

export class NessyServeAdapter implements AgentPort {
	readonly capabilities: Capabilities = { streamText: true, midTurn: true, permissionVote: true, setModel: false }

	private readonly client: NessyGateway
	private readonly cwd: string
	private readonly clock: Clock
	private readonly originatorClientId: string | null
	private readonly sessions = new Map<string, SessionSynth>()

	constructor(opts: NessyServeAdapterOptions) {
		this.client = opts.client
		this.cwd = opts.cwd
		this.clock = opts.clock ?? { now: () => Date.now() }
		this.originatorClientId = opts.originatorClientId ?? null
	}

	async sessionCreate(_cwd?: string): Promise<{ sessionId: string }> {
		const { sessionId } = await this.client.createSession(this.cwd)
		this.sessions.set(sessionId, this.newSynth(sessionId))
		return { sessionId }
	}

	/**
	 * Поднять сессию и вернуть lastSeq в adapter-space (с него продолжать подписку). Внутри резюм работает от
	 * транспортного id: restoreSession отдаёт транспортный lastEventId, который хранится в resumeTransportId и
	 * используется subscribe(); наружу возвращается adapter-seq (null, если событий в adapter-space ещё не было).
	 */
	async sessionResume(sessionId: string, _cwd?: string): Promise<{ lastSeq: number | null } | null> {
		const r = await this.client.restoreSession(sessionId, this.cwd)
		if (!r) return null
		const synth = this.ensureSession(sessionId)
		synth.ready = false
		synth.resumeTransportId = r.lastEventId
		return { lastSeq: r.lastEventId === null ? null : this.adapterSeqForTransport(synth, r.lastEventId) }
	}

	async promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		const synth = this.ensureSession(sessionId)
		synth.text = ''
		let promptId: string | null
		try {
			const r = await this.client.prompt(sessionId, text)
			promptId = r.promptId
		} catch (e) {
			// постановка не удалась: терминальное turn.failed вместо висячего turn.started (парность не нарушается)
			this.emit(synth, { type: 'turn.failed', data: { message: errMsg(e), retryable: e instanceof NessyBusyError, code: null } })
			throw e
		}
		synth.turnOpen = true
		this.emit(synth, { type: 'turn.started', data: { promptId } })
		return { promptId }
	}

	async promptCancel(sessionId: string): Promise<void> {
		return this.client.cancel(sessionId)
	}

	async permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		return this.client.vote(sessionId, requestId, optionId)
	}

	async midTurnSend(sessionId: string, message: string): Promise<boolean> {
		return this.client.midTurn(sessionId, message)
	}

	async sessionClose(sessionId: string): Promise<void> {
		const synth = this.sessions.get(sessionId)
		if (synth?.turnOpen) {
			// чистое закрытие обрывает открытый ход — гарантируем парность
			synth.turnOpen = false
			this.emit(synth, { type: 'turn.cancelled', data: { promptId: null } })
		}
		if (synth) this.emit(synth, { type: 'session.closed', data: { sessionId } })
		this.sessions.delete(sessionId)
		return this.client.closeSession(sessionId)
	}

	modelSet(_sessionId: string, _model: string): Promise<never> {
		return Promise.reject(new AppError(501, 'model_not_supported', 'смена модели недоступна для nessy serve'))
	}

	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription {
		const synth = this.ensureSession(sessionId)
		synth.subscriber = opts.onEvent
		const transportResumeId = this.transportIdForLastSeq(synth, opts.lastSeq ?? null)
		const sub = this.client.subscribe(sessionId, {
			lastEventId: transportResumeId,
			onEvent: (ev, eventId) => this.onSessionEvent(synth, opts.onEvent, ev, eventId),
		})
		// сессия готова: обязательное core-событие (синтез из успешного create/resume)
		if (!synth.ready) {
			synth.ready = true
			opts.onEvent(this.wrap(synth, null, { type: 'session.ready', data: { sessionId } }))
		}
		return {
			close(): void {
				sub.close()
				if (synth.subscriber === opts.onEvent) synth.subscriber = null
			},
		}
	}

	private onSessionEvent(synth: SessionSynth, emit: PortEventListener, ev: SessionEvent, eventId: number | null): void {
		// обрыв/прерывание транспорта посреди открытого хода → синтезировать терминальное turn.failed
		if ((ev.kind === 'died' || ev.kind === 'evicted' || ev.kind === 'resync') && synth.turnOpen) {
			synth.turnOpen = false
			emit(this.wrap(synth, null, { type: 'turn.failed', data: { message: ev.kind === 'died' ? ev.reason : 'соединение с рантаймом оборвано', retryable: false, code: null } }))
		}
		const port = sessionEventToPortEvent(ev)
		if (!port) return
		if (port.type === 'message.delta') synth.text += port.data.text
		if (port.type === 'turn.completed' || port.type === 'turn.failed' || port.type === 'turn.cancelled') {
			synth.turnOpen = false
			if (port.type === 'turn.completed' && synth.text) {
				emit(this.wrap(synth, null, { type: 'message.completed', data: { messageId: null, text: synth.text } }))
				synth.text = ''
			}
		}
		emit(this.wrap(synth, eventId, port))
	}

	private ensureSession(sessionId: string): SessionSynth {
		let synth = this.sessions.get(sessionId)
		if (!synth) {
			synth = this.newSynth(sessionId)
			this.sessions.set(sessionId, synth)
		}
		return synth
	}

	private newSynth(id: string): SessionSynth {
		return { id, ready: false, text: '', subscriber: null, seq: 0, adapterToTransport: new Map(), resumeTransportId: null, turnOpen: false }
	}

	/** Доставить синтезированное событие текущему подписчику сессии (если он есть). */
	private emit(synth: SessionSynth, port: PortEvent): void {
		synth.subscriber?.(this.wrap(synth, null, port))
	}

	private wrap(synth: SessionSynth, transportEventId: number | null, port: PortEvent): Envelope {
		synth.seq += 1
		const seq = synth.seq
		if (transportEventId !== null) synth.adapterToTransport.set(seq, transportEventId)
		return {
			v: 1,
			sessionId: synth.id,
			seq,
			ts: this.clock.now(),
			originatorClientId: this.originatorClientId,
			type: port.type,
			data: port.data,
		}
	}

	/** Транспортный id для Last-Event-ID по lastSeq (adapter-space): последний нативный транспортный id c seq ≤ lastSeq. */
	private transportIdForLastSeq(synth: SessionSynth, lastSeq: number | null): number | null {
		let best: number | null = null
		if (lastSeq !== null) {
			for (const [aseq, tid] of synth.adapterToTransport) if (aseq <= lastSeq && (best === null || tid > best)) best = tid
			if (best !== null) return best
		}
		return synth.resumeTransportId ?? null
	}

	/** Наибольший adapter-seq, чей транспортный id ≤ transportId; null, если mapping ещё пуст. */
	private adapterSeqForTransport(synth: SessionSynth, transportId: number): number | null {
		let best: number | null = null
		for (const [aseq, tid] of synth.adapterToTransport) if (tid <= transportId && (best === null || aseq > best)) best = aseq
		return best
	}
}