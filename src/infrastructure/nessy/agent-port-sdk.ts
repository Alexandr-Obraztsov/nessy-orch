/**
 * NessySdkAgentPort — реализация AgentPort поверх @nestor/nessy-cli-sdk (§6б дизайна). Ядро P1: адаптер
 * nessy-sdk рантайма; replace serve-пути после зелёного перехода (решение пользователя).
 *
 * Модель: один query-хэндл на сессию. session.create спавнит query с async-очередью промптов (multi-turn):
 * SDK держит процесс живым, пока очередь открыта; prompt.send кладёт SDKUserMessage в очередь, model отвечает,
 * на result синтезируется turn.completed с UnifiedUsage. session.close закрывает очередь — SDK завершает ход и процесс.
 *
 * Маппинг SDKMessage → Envelope(PortEvent):
 *  - system/init        → session.ready + верификация модели (адаптер не доверяет опции модели, §3);
 *  - stream_event text_delta → message.delta (includePartialMessages);
 *  - assistant          → message.completed (полный текст блока);
 *  - result success     → turn.completed (UnifiedUsage из usage);
 *  - result error_*     → turn.failed;
 *  - exit code 130      → turn.cancelled + принудительное закрытие хэндла (interrupt() грязный: §6б);
 *  - canUseTool         → permission.requested/resolved (очередь запросов → vote).
 *
 * Capabilities: { streamText: true, midTurn: false, permissionVote: true, setModel: true }. Прямого mid-turn в канале
 * SDK нет (только serve-путь DaemonSessionClient), поэтому midTurn=false (§6б). Тёплый пул не строится (старт 2.7с).
 *
 * Единица seq: Envelope.seq — единый монотонный per-session счётчик адаптера для всех событий (нативных и синтезированных),
 * чтобы seq наружу был строго монотонным и уникальным (conformance).
 */
import { randomUUID } from 'node:crypto'
import { query, type PermissionResult, type Query, type QueryOptions, type SDKMessage, type SDKUserMessage } from '@nestor/nessy-cli-sdk'
import type { AgentPort, Capabilities, Envelope, PortEvent, PortSubscription, PortSubscribeOptions } from '../../application/agent-port'
import { AppError } from '../../domain/errors'
import { errMsg } from '../../lib/json'
import { isExit130, PromptQueue, type SessionState } from './agent-port-sdk-session'

/** Фабрика Query — отделяется для тестов (инжектится мок; живой вызов — по умолчанию SDK.query). */
export type MakeQuery = (args: { prompt: string | AsyncIterable<SDKUserMessage>; options?: QueryOptions }) => Query

export interface NessySdkAgentPortOptions {
	/** воркспейс, в котором создаются сессии (путь пространства). */
	cwd: string
	/** ожидаемая модель для верификации по system/init; не задана — верификация не выполняется. */
	model?: string
	/** права: 'default' — write-инструменты через canUseTool (permissionVote); 'auto' — автоодобрение. */
	permissionMode?: 'default' | 'plan' | 'auto-edit' | 'auto'
	/** часы для ts событий (по умолчанию Date.now). */
	clock?: { now(): number }
	/** идентификатор клиента-происхождения (null — не указан). */
	originatorClientId?: string | null
	/** фабрика Query (по умолчанию SDK.query) — для тестов и расширения. */
	makeQuery?: MakeQuery
}

export class NessySdkAgentPort implements AgentPort {
	readonly capabilities: Capabilities = { streamText: true, midTurn: false, permissionVote: true, setModel: true }

	private readonly cwd: string
	private readonly expectedModel: string | undefined
	private readonly permissionMode: NonNullable<QueryOptions['permissionMode']>
	private readonly clock: { now(): number }
	private readonly originatorClientId: string | null
	private readonly makeQuery: MakeQuery
	private readonly sessions = new Map<string, SessionState>()

	constructor(opts: NessySdkAgentPortOptions) {
		this.cwd = opts.cwd
		this.expectedModel = opts.model
		this.permissionMode = opts.permissionMode ?? 'default'
		this.clock = opts.clock ?? { now: () => Date.now() }
		this.originatorClientId = opts.originatorClientId ?? null
		this.makeQuery = opts.makeQuery ?? query
	}

	sessionCreate(_cwd?: string): Promise<{ sessionId: string }> {
		const sessionId = randomUUID()
		const queue = new PromptQueue()
		const q = this.makeQuery({ prompt: queue, options: this.buildOptions(sessionId) })
		const state: SessionState = {
			id: sessionId,
			query: q,
			queue,
			seq: 0,
			subscriber: null,
			turnOpen: false,
			promptId: null,
			text: '',
			ready: false,
			permissions: new Map(),
			actualModel: null,
			closed: false,
			named: false,
		}
		this.sessions.set(sessionId, state)
		void this.consume(state)
		return Promise.resolve({ sessionId })
	}

	sessionResume(sessionId: string, _cwd?: string): Promise<{ lastSeq: number | null } | null> {
		// SDK: резюм — это новый query с resume:sessionId (контекст модели поднимается на диске). lastSeq в adapter-space
		// SDK не отдаёт — возвращаем null (подписка продолжается с текущего seq, повтор истории недоступен). Сбрасываем
		// готовность, чтобы следующая подписка синтезировала session.ready заново (§3 «поздняя подписка»).
		const existing = this.sessions.get(sessionId)
		if (existing && !existing.closed) {
			existing.ready = false
			return Promise.resolve({ lastSeq: null })
		}
		return Promise.resolve(null)
	}

	promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return Promise.reject(new AppError(404, 'session_not_found', `сессия «${sessionId}» не найдена`))
		const promptId = randomUUID()
		state.text = ''
		state.promptId = promptId
		state.turnOpen = true
		// первый промпт даёт имя сессии (displayName) — как у serve-пути (§3, session.meta)
		if (!state.named) {
			state.named = true
			this.emit(state, { type: 'session.meta', data: { displayName: text.slice(0, 40) } })
		}
		this.emit(state, { type: 'turn.started', data: { promptId } })
		state.queue.push({
			type: 'user',
			session_id: sessionId,
			message: { role: 'user', content: text },
			parent_tool_use_id: null,
		})
		return Promise.resolve({ promptId })
	}

	async promptCancel(sessionId: string): Promise<void> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return
		try {
			await state.query.interrupt()
		} catch {
			/* interrupt грязный: настоящую отмену зафиксирует выход процесса 130 в consume() */
		}
		// interrupt грязный: exit-130 в consume() синтезирует turn.cancelled и закрывает хэндл; forceClose идемпотентен
		this.forceClose(state, 'promptCancel')
	}

	permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return Promise.resolve()
		const resolve = state.permissions.get(requestId)
		if (!resolve) return Promise.reject(new AppError(404, 'permission_not_found', `запрос разрешения «${requestId}» не найден`))
		state.permissions.delete(requestId)
		if (optionId === null || optionId === 'deny') {
			resolve({ behavior: 'deny', message: 'отклонено оператором' })
		} else {
			resolve({ behavior: 'allow', updatedInput: {} })
		}
		this.emit(state, { type: 'permission.resolved', data: { requestId, optionId } })
		return Promise.resolve()
	}

	async modelSet(sessionId: string, model: string): Promise<void> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) throw new AppError(404, 'session_not_found', `сессия «${sessionId}» не найдена`)
		try {
			await state.query.setModel(model)
			state.actualModel = model
			this.emit(state, { type: 'model.switched', data: { model } })
		} catch (e) {
			this.emit(state, { type: 'model.switch_failed', data: { expected: model, actual: state.actualModel, message: errMsg(e) } })
			throw e
		}
	}

	async midTurnSend(_sessionId: string, _message: string): Promise<never> {
		return Promise.reject(new AppError(501, 'mid_turn_not_supported', 'mid-turn недоступен для nessy-sdk'))
	}

	async sessionClose(sessionId: string): Promise<void> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return
		if (state.turnOpen) {
			state.turnOpen = false
			this.emit(state, { type: 'turn.cancelled', data: { promptId: state.promptId } })
		}
		state.queue.end()
		this.emit(state, { type: 'session.closed', data: { sessionId } })
		this.sessions.delete(sessionId)
		try {
			await state.query.close()
		} catch {
			/* процесс мог уже упасть — закрытие необязательно */
		}
	}

	/** Закрыть все живые сессии (остановка пространства/оркестратора): без этого CLI-процессы nessy остаются осиротевшими. */
	async closeAll(): Promise<void> {
		const ids = [...this.sessions.keys()]
		await Promise.all(ids.map(id => this.sessionClose(id).catch(() => undefined)))
	}

	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription {
		const state = this.sessions.get(sessionId)
		if (!state) throw new AppError(404, 'session_not_found', `сессия «${sessionId}» не найдена`)
		state.subscriber = opts.onEvent
		// готовность сессии: обязательное core-событие (синтез из успешного create/resume, §3 «правило происхождения»).
		// system/init придёт отдельно с верификацией модели; ready не дублируется, пока ready не сброшен sessionResume.
		if (!state.ready) {
			state.ready = true
			this.emit(state, { type: 'session.ready', data: { sessionId } })
		}
		return {
			close(): void {
				if (state.subscriber === opts.onEvent) state.subscriber = null
			},
		}
	}

	// ---------- внутреннее ----------
	private buildOptions(sessionId: string): QueryOptions {
		return {
			cwd: this.cwd,
			sessionId,
			...(this.expectedModel !== undefined ? { model: this.expectedModel } : {}),
			includePartialMessages: true,
			permissionMode: this.permissionMode,
			canUseTool: (toolName, input) => this.onCanUseTool(sessionId, toolName, input),
			abortController: new AbortController(),
			maxSessionTurns: -1,
		}
	}

	/** canUseTool (SDK): эмитим permission.requested и ждём permissionVote; результат применяется SDK. */
	private onCanUseTool(sessionId: string, toolName: string, _input: Record<string, unknown>): Promise<PermissionResult> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return Promise.resolve({ behavior: 'deny', message: 'сессия закрыта' })
		return new Promise<PermissionResult>(resolve => {
			const requestId = randomUUID()
			state.permissions.set(requestId, resolve)
			this.emit(state, {
				type: 'permission.requested',
				data: {
					requestId,
					title: toolName,
					options: [
						{ optionId: 'allow', kind: 'allow', name: 'Разрешить' },
						{ optionId: 'deny', kind: 'deny', name: 'Отклонить' },
					],
				},
			})
		})
	}

	/** Читать поток SDKMessage сессии и переводить в Envelope. */
	private async consume(state: SessionState): Promise<void> {
		try {
			for await (const msg of state.query) this.onMessage(state, msg)
		} catch (e) {
			if (isExit130(e)) {
				// interrupt() грязный: процесс умирает кодом 130, result нет — синтезируем отмену хода и закрываем хэндл
				this.forceClose(state, 'exit130')
			} else if (!state.closed) {
				this.terminate(state, { type: 'error', data: { message: errMsg(e) } })
				this.forceClose(state, 'error')
			}
		}
	}

	private onMessage(state: SessionState, msg: SDKMessage): void {
		switch (msg.type) {
			case 'system': {
				if (msg.subtype === 'init') {
					state.actualModel = msg.model ?? null
					if (!state.ready) {
						state.ready = true
						this.emit(state, { type: 'session.ready', data: { sessionId: state.id } })
					}
					if (this.expectedModel && msg.model && msg.model !== this.expectedModel) {
						this.emit(state, {
							type: 'model.switch_failed',
							data: { expected: this.expectedModel, actual: msg.model, message: `модель nessy ${msg.model} не совпадает с ожидаемой ${this.expectedModel}` },
						})
					}
				}
				return
			}
			case 'stream_event': {
				// partial-текст (includePartialMessages): стриминг чанками
				const ev = msg.event
				if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
					state.text += ev.delta.text
					this.emit(state, { type: 'message.delta', data: { messageId: null, text: ev.delta.text } })
				}
				return
			}
			case 'assistant': {
				const blocks = msg.message.content
				const texts = blocks
					.filter((b): b is { type: 'text'; text: string } => b.type === 'text')
					.map(b => b.text)
					.join('')
				if (texts) this.emit(state, { type: 'message.completed', data: { messageId: null, text: texts } })
				return
			}
			case 'result': {
				if (msg.is_error) {
					this.terminate(state, {
						type: 'turn.failed',
						data: { message: msg.error?.message ?? 'ошибка хода', retryable: msg.subtype === 'error_during_execution', code: null },
					})
				} else {
					this.emit(state, { type: 'turn.completed', data: { stopReason: msg.subtype, promptId: state.promptId } })
					this.emit(state, { type: 'context.usage', data: this.usageOf(msg) })
				}
				state.turnOpen = false
				return
			}
			default:
				return
		}
	}

	/** UnifiedUsage из result.usage. */
	private usageOf(msg: Extract<SDKMessage, { type: 'result' }>): { used: number; size: number } {
		const u = msg.usage
		const inputTokens = u.input_tokens
		const outputTokens = u.output_tokens
		const total = u.total_tokens ?? null
		// контекстный usage не отдаёт окно модели — оставляем размер 0 (метрика «контекст %» для nessy-sdk не считается)
		return { used: total === null ? inputTokens + outputTokens : total, size: 0 }
	}

	/** Терминальное событие открытого хода (гарантия парности turn.started → терминал). */
	private terminate(state: SessionState, ev: PortEvent): void {
		if (state.turnOpen) {
			state.turnOpen = false
			this.emit(state, ev)
		}
	}

	/** Принудительно закрыть хэндл: разрезолвить висящие разрешения и записать закрытое состояние. */
	private forceClose(state: SessionState, reason: string): void {
		if (state.closed) return
		if (state.turnOpen) {
			state.turnOpen = false
			this.emit(state, { type: 'turn.cancelled', data: { promptId: state.promptId } })
		}
		for (const resolve of state.permissions.values()) resolve({ behavior: 'deny', message: `хэндл закрыт (${reason})` })
		state.permissions.clear()
		state.closed = true
		this.sessions.delete(state.id)
	}

	private emit(state: SessionState, port: PortEvent): void {
		if (state.closed) return
		state.seq += 1
		const envelope: Envelope = {
			v: 1,
			sessionId: state.id,
			seq: state.seq,
			ts: this.clock.now(),
			originatorClientId: this.originatorClientId,
			type: port.type,
			data: port.data,
		}
		state.subscriber?.(envelope)
	}
}
