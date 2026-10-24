/**
 * NessySdkAgentPort — реализация AgentPort поверх @nestor/nessy-cli-sdk (§6б дизайна). Ядро P1: адаптер
 * nessy-sdk рантайма; replace serve-пути после зелёного перехода (решение пользователя).
 *
 * Модель: один query-хэндл на сессию. session.create спавнит query с async-очередью промптов (multi-turn):
 * SDK держит процесс живым, пока очередь открыта; prompt.send кладёт SDKUserMessage в очередь, model отвечает,
 * на result синтезируется turn.completed с UnifiedUsage. session.close закрывает очередь — SDK завершает ход и процесс.
 *
 * §6б-резюм: session.close сохраняет {sessionId, lastSeq, model, cwd} в closed-registry; session.resume(id) для
 * закрытой сессии восстанавливает хэндл (query с QueryOptions.resume), seq продолжается от lastSeq — контекст
 * «park→resume» больше не теряется.
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
import { isExit130, usageOfResult, createSdkSessionState, type ClosedSession, type SessionState } from './agent-port-sdk-session'
import { emitToolResult, emitToolUse } from './agent-port-sdk-tools'

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
	/** §6б: закрытые сессии, чтобы session.resume мог вернуть спецификацию восстановления контекста. */
	private readonly closed = new Map<string, ClosedSession>()

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
		const state = createSdkSessionState(sessionId, { resume: null, seq: 0, actualModel: null, named: false })
		this.sessions.set(sessionId, state)
		this.spawnQuery(state)
		return Promise.resolve({ sessionId })
	}

	sessionResume(sessionId: string, _cwd?: string): Promise<{ lastSeq: number | null } | null> {
		const existing = this.sessions.get(sessionId)
		if (existing && !existing.closed) {
			// живая сессия: готовность синтезируется на следующей подписке (§3 «поздняя подписка»)
			existing.ready = false
			return Promise.resolve({ lastSeq: null })
		}
		const saved = this.closed.get(sessionId)
		if (!saved) return Promise.resolve(null)
		// §6б-резюм закрытой сессии: восстанавливаем хэндл; query спавнится лениво при первом prompt.send.
		// seq продолжается от lastSeq, чтобы наружу seq оставался строго монотонным сквозь close/resume.
		const state = createSdkSessionState(sessionId, { resume: sessionId, seq: saved.lastSeq, actualModel: saved.model, named: true })
		this.sessions.set(sessionId, state)
		this.closed.delete(sessionId)
		return Promise.resolve({ lastSeq: saved.lastSeq })
	}

	promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return Promise.reject(new AppError(404, 'session_not_found', `сессия «${sessionId}» не найдена`))
		if (state.turnOpen) {
			// ядро сериализует промпты, но адаптер обязан защищаться от параллельной отправки (§3)
			return Promise.reject(new AppError(409, 'session_busy', `сессия «${sessionId}» занята ходом; дождитесь терминала`))
		}
		// ленивый спавн резюма: query поднялся на sessionResume, но процесс поднимаем только под первый ход
		if (state.query === null) this.spawnQuery(state)
		const promptId = randomUUID()
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
			await state.query?.interrupt()
		} catch {
			/* interrupt грязный: настоящую отмену зафиксирует выход процесса 130 в consume() */
		}
		// interrupt грязный: exit-130 в consume() синтезирует turn.cancelled и закрывает хэндл; forceClose идемпотентен
		this.forceClose(state, 'promptCancel')
	}

	permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return Promise.resolve()
		const entry = state.permissions.get(requestId)
		if (!entry) return Promise.reject(new AppError(404, 'permission_not_found', `запрос разрешения «${requestId}» не найден`))
		state.permissions.delete(requestId)
		// строгий голос: optionId обязан совпадать с заявленной опцией; иначе — deny (§3, permissionVote)
		const opt = optionId === null ? undefined : entry.options.find(o => o.optionId === optionId)
		if (opt && opt.kind === 'allow') {
			entry.resolve({ behavior: 'allow', updatedInput: {} })
		} else {
			entry.resolve({ behavior: 'deny', message: opt ? 'отклонено оператором' : `неизвестная опция «${optionId}»` })
		}
		this.emit(state, { type: 'permission.resolved', data: { requestId, optionId } })
		return Promise.resolve()
	}

	async modelSet(sessionId: string, model: string): Promise<void> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) throw new AppError(404, 'session_not_found', `сессия «${sessionId}» не найдена`)
		if (!state.query) throw new AppError(409, 'session_busy', `сессия «${sessionId}» в режиме резюма; отправьте промпт`)
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
		this.resolveAllPermissions(state, 'сессия закрыта')
		// §6б: сохраняем спецификацию восстановления ДО удаления, чтобы sessionResume мог вернуть её
		this.closed.set(sessionId, { lastSeq: state.seq, model: state.actualModel, cwd: this.cwd })
		this.emit(state, { type: 'session.closed', data: { sessionId } })
		state.closed = true
		state.queue.end()
		this.sessions.delete(sessionId)
		try {
			await state.query?.close()
		} catch {
			/* процесс мог уже упасть — закрытие необязательно */
		}
		// abort-контроллер SDK: принудительно гасим процесс, если он ещё жив (двойная страховка к queue.end())
		state.abortController.abort()
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
	/** Спавн query-хэндла SDK (свежая сессия — через sessionId; резюм — через resume). */
	private spawnQuery(state: SessionState): void {
		const q = this.makeQuery({ prompt: state.queue, options: this.buildOptions(state) })
		state.query = q
		void this.consume(state)
	}

	private buildOptions(state: SessionState): QueryOptions {
		return {
			cwd: this.cwd,
			...(state.resume ? { resume: state.resume } : { sessionId: state.id }),
			...(this.expectedModel !== undefined ? { model: this.expectedModel } : {}),
			includePartialMessages: true,
			permissionMode: this.permissionMode,
			// SDK-ребёнок наследует process.env: затираем токен оператора (§3 «секреты в env детей»)
			env: { NESSY_ORCH_TOKEN: '' },
			canUseTool: (toolName, input) => this.onCanUseTool(state.id, toolName, input),
			abortController: state.abortController,
			maxSessionTurns: -1,
		}
	}

	/** canUseTool (SDK): эмитим permission.requested и ждём permissionVote; результат применяется SDK. */
	private onCanUseTool(sessionId: string, toolName: string, _input: Record<string, unknown>): Promise<PermissionResult> {
		const state = this.sessions.get(sessionId)
		if (!state || state.closed) return Promise.resolve({ behavior: 'deny', message: 'сессия закрыта' })
		const options = [
			{ optionId: 'allow', kind: 'allow', name: 'Разрешить' },
			{ optionId: 'deny', kind: 'deny', name: 'Отклонить' },
		]
		return new Promise<PermissionResult>(resolve => {
			const requestId = randomUUID()
			state.permissions.set(requestId, { resolve, options })
			this.emit(state, {
				type: 'permission.requested',
				data: { requestId, title: toolName, options },
			})
		})
	}

	/** Читать поток SDKMessage сессии и переводить в Envelope. */
	private async consume(state: SessionState): Promise<void> {
		try {
			if (!state.query) return
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
					this.emit(state, { type: 'message.delta', data: { messageId: null, text: ev.delta.text } })
				}
				return
			}
			case 'assistant': {
				const texts: string[] = []
				for (const b of msg.message.content) {
					if (b.type === 'text') texts.push(b.text)
					else if (b.type === 'tool_use') emitToolUse(state, (s, e) => this.emit(s, e), b.id, b.name, b.input)
					else if (b.type === 'tool_result') emitToolResult(state, (s, e) => this.emit(s, e), b.tool_use_id, b.content, b.is_error)
				}
				if (texts.length) this.emit(state, { type: 'message.completed', data: { messageId: null, text: texts.join('') } })
				return
			}
			case 'user': {
				// tool_result приходит от CLI обратно SDK в user-сообщении: завершаем tool_call (§3)
				if (Array.isArray(msg.message.content))
					for (const b of msg.message.content)
						if (b.type === 'tool_result') emitToolResult(state, (s, e) => this.emit(s, e), b.tool_use_id, b.content, b.is_error)
				return
			}
			case 'result': {
				// гейт на закрытие: после cancelled+session.closed поздний result не синтезирует turn.completed/usage
				if (!state.turnOpen) return
				if (msg.is_error) {
					this.terminate(state, {
						type: 'turn.failed',
						data: { message: msg.error?.message ?? 'ошибка хода', retryable: msg.subtype === 'error_during_execution', code: null },
					})
				} else {
					this.terminate(state, { type: 'turn.completed', data: { stopReason: msg.subtype, promptId: state.promptId } })
					this.emit(state, { type: 'context.usage', data: usageOfResult(msg) })
				}
				return
			}
			default:
				return
		}
	}

	/** Терминальное событие открытого хода (гарантия парности turn.started → терминал). */
	private terminate(state: SessionState, ev: PortEvent): void {
		if (state.turnOpen) {
			state.turnOpen = false
			this.emit(state, ev)
		}
	}

	/** Разрезолвить все висящие canUseTool-промисы отказом (закрытие хэндла: запросы больше не получат голоса). */
	private resolveAllPermissions(state: SessionState, message: string): void {
		for (const entry of state.permissions.values()) entry.resolve({ behavior: 'deny', message })
		state.permissions.clear()
	}

	/** Принудительно закрыть хэндл: разрезолвить висящие разрешения и записать закрытое состояние. */
	private forceClose(state: SessionState, reason: string): void {
		if (state.closed) return
		if (state.turnOpen) {
			state.turnOpen = false
			this.emit(state, { type: 'turn.cancelled', data: { promptId: state.promptId } })
		}
		this.resolveAllPermissions(state, `хэндл закрыт (${reason})`)
		this.emit(state, { type: 'session.closed', data: { sessionId: state.id } }) // клиент узнаёт о смерти хэндла
		state.closed = true
		state.abortController.abort()
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
		// исключение подписчика не должно убивать сессию/процесс: логируем и продолжаем
		try {
			state.subscriber?.(envelope)
		} catch (e) {
			console.error(`[nessy-orch] подписчик сессии ${state.id} бросил исключение: ${errMsg(e)}`)
		}
	}
}
