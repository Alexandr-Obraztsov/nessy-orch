import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { AgentPort, Capabilities, Envelope, PortEvent, PortSubscription, PortSubscribeOptions, UnifiedUsage } from '../../application/agent-port'
import { AppError } from '../../domain/errors'
import { spawnClaude, type SpawnClaudeFn, type SpawnClaudeOptions } from './spawn-claude'
import {
	DEFAULT_PERMISSION_MODE,
	KILL_GRACE_MS,
	appendStderrTail,
	emitModelSwitchFailedIfNeeded,
	newSessionState,
	processLine,
	toError,
	type TclaudeSession,
} from './tclaude-session'

export interface TclaudeAdapterOptions {
	/** путь к бинарю tclaude (по умолчанию из окружения TCLAUDE_BIN) */
	bin?: string
	/** модель по умолчанию для новых сессий (null — дефолт рантайма) */
	model?: string | null
	/** режим разрешений --permission-mode; безопасный дефолт — 'default' */
	permissionMode?: string
	/** часы для ts событий */
	clock?: { now(): number }
	/** идентификатор клиента-происхождения */
	originatorClientId?: string | null
	/** спавн-функция (в unit-тестах — фейк) */
	spawn?: SpawnClaudeFn
}

/**
 * TclaudeAgentPort — реализация AgentPort поверх headless tclaude CLI (child_process + stream-json).
 * Сессия = живой процесс tclaude с изолированным HOME; события шлются NDJSON в stdout.
 * Маппинг: system/init→верификация модели; assistant→message.delta/completed; result→turn.completed
 * с UnifiedUsage; error→turn.failed; обрыв процесса→turn.failed. Терминал отмены синтезируется
 * операцией (см. promptCancel). seq — единый монотонный per-session счётчик адаптера.
 */
export class TclaudeAgentPort implements AgentPort {
	readonly capabilities: Capabilities = { streamText: true, midTurn: true, permissionVote: false, setModel: true }

	private readonly bin: string
	private readonly model: string | null
	private readonly permissionMode: string
	private readonly clock: { now(): number }
	private readonly originatorClientId: string | null
	private readonly spawn: SpawnClaudeFn
	private readonly sessions = new Map<string, TclaudeSession>()

	constructor(opts: TclaudeAdapterOptions = {}) {
		this.bin = opts.bin ?? process.env.TCLAUDE_BIN ?? `${process.env.HOME ?? ''}/.local/bin/tclaude`
		this.model = opts.model ?? null
		this.permissionMode = opts.permissionMode ?? DEFAULT_PERMISSION_MODE
		this.clock = opts.clock ?? { now: () => Date.now() }
		this.originatorClientId = opts.originatorClientId ?? null
		this.spawn = opts.spawn ?? spawnClaude
	}

	sessionCreate(cwd: string): Promise<{ sessionId: string }> {
		const sessionId = randomUUID()
		const homeDir = mkdtempSync(join(tmpdir(), 'tclaude-agent-'))
		try {
			const s = newSessionState(sessionId, cwd, homeDir, this.model, this.permissionMode)
			this.spawnProcess(s, { resume: false })
			this.sessions.set(sessionId, s)
			return Promise.resolve({ sessionId })
		} catch (e) {
			// спавн упал (бинар недоступен и т.п.): временный HOME агента больше не нужен — не оставляем утечки
			try {
				rmSync(homeDir, { recursive: true, force: true })
			} catch {
				/* не критично: каталог под tmpdir, осиротеет при перезагрузке */
			}
			return Promise.reject(toError(e))
		}
	}

	sessionResume(sessionId: string, cwd: string): Promise<{ lastSeq: number | null } | null> {
		const s = this.sessions.get(sessionId)
		if (!s) return Promise.resolve(null)
		try {
			// живая сессия: переподнимаем процесс с --resume, сохраняя HOME и модель; готовность — на новой подписке
			s.ready = false
			s.cwd = cwd || s.cwd
			this.respawn(s)
			return Promise.resolve({ lastSeq: null })
		} catch (e) {
			return Promise.reject(toError(e))
		}
	}

	promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		try {
			const s = this.requireSession(sessionId)
			s.text = ''
			s.cancelRequested = false
			// после result процесс `-p` завершается: на новый ход переподнимаем его с --resume, чтобы контекст сохранился
			if (!this.isChildAlive(s)) this.respawn(s)
			// сначала запись в stdin (может упасть — тогда без висячего turn.started), затем открываем ход
			this.writeInput(s, this.userMessage(s.id, text))
			s.turnOpen = true
			this.emit(s, { type: 'turn.started', data: { promptId: null } })
			return Promise.resolve({ promptId: null })
		} catch (e) {
			return Promise.reject(toError(e))
		}
	}

	promptCancel(sessionId: string): Promise<void> {
		try {
			const s = this.requireSession(sessionId)
			s.cancelRequested = true
			s.child?.kill('SIGINT')
			if (s.turnOpen) {
				// терминал синтезируется операцией; поздний result после SIGINT игнорируется (гонка)
				s.turnOpen = false
				this.emit(s, { type: 'turn.cancelled', data: { promptId: null } })
			}
			return Promise.resolve()
		} catch (e) {
			return Promise.reject(toError(e))
		}
	}

	permissionVote(_sessionId: string, _requestId: string, _optionId: string | null): Promise<never> {
		return Promise.reject(new AppError(501, 'permission_not_supported', 'голосование по разрешениям недоступно для tclaude'))
	}

	modelSet(sessionId: string, model: string): Promise<void> {
		try {
			const s = this.requireSession(sessionId)
			s.model = model
			// --model работает только при спавне: перезапускаем процесс с новой моделью и поднимаем сессию
			s.verifyResult = null
			s.actualModel = null
			s.modelSwitchFailedEmitted = false
			this.respawn(s)
			this.emit(s, { type: 'model.switched', data: { model } })
			return Promise.resolve()
		} catch (e) {
			return Promise.reject(toError(e))
		}
	}

	midTurnSend(sessionId: string, message: string): Promise<boolean> {
		const s = this.sessions.get(sessionId)
		if (!s) return Promise.reject(new AppError(404, 'session_not_found', `сессия ${sessionId} не найдена`))
		const child = s.child
		if (!child || !child.stdin || child.stdin.destroyed || !child.stdin.writable) return Promise.resolve(false)
		try {
			child.stdin.write(JSON.stringify(this.userMessage(s.id, message, true)) + '\n')
		} catch {
			return Promise.resolve(false)
		}
		this.emit(s, { type: 'mid_turn.injected', data: { count: 1 } })
		return Promise.resolve(true)
	}

	sessionClose(sessionId: string): Promise<void> {
		const s = this.sessions.get(sessionId)
		if (!s) return Promise.resolve()
		if (s.turnOpen) {
			s.turnOpen = false
			this.emit(s, { type: 'turn.cancelled', data: { promptId: null } })
		}
		this.emit(s, { type: 'session.closed', data: { sessionId } })
		s.detached = true
		this.sessions.delete(sessionId)
		const child = s.child
		if (child) this.killGracefully(child, 'SIGINT')
		// временный HOME агента больше не нужен — убираем только свой каталог
		try {
			rmSync(s.homeDir, { recursive: true, force: true })
		} catch {
			/* не критично: каталог под tmpdir, осиротеет при перезагрузке */
		}
		return Promise.resolve()
	}

	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription {
		const s = this.requireSession(sessionId)
		s.subscriber = opts.onEvent
		if (!s.ready) {
			s.ready = true
			this.emit(s, { type: 'session.ready', data: { sessionId } })
		}
		emitModelSwitchFailedIfNeeded(s, port => this.emit(s, port))
		return {
			close: (): void => {
				if (s.subscriber === opts.onEvent) s.subscriber = null
			},
		}
	}

	/** UnifiedUsage последнего завершённого хода сессии (result), иначе null. */
	sessionUsage(sessionId: string): UnifiedUsage | null {
		return this.sessions.get(sessionId)?.lastUsage ?? null
	}

	/** Фактическая модель из system/init сессии (null — init ещё не приходил). */
	sessionModel(sessionId: string): string | null {
		return this.sessions.get(sessionId)?.actualModel ?? null
	}

	/** Закрыть все живые сессии (остановка пространства/оркестратора): иначе процессы tclaude остаются осиротевшими. */
	async closeAll(): Promise<void> {
		const ids = [...this.sessions.keys()]
		await Promise.all(ids.map(id => this.sessionClose(id).catch(() => undefined)))
	}

	// ---------- внутреннее ----------

	private spawnProcess(s: TclaudeSession, opts: { resume: boolean; model?: string | null }): void {
		const spawnOpts: SpawnClaudeOptions = {
			bin: this.bin,
			model: opts.model ?? s.model,
			sessionId: s.id,
			resume: opts.resume,
			permissionMode: s.permissionMode,
			homeDir: s.homeDir,
			cwd: s.cwd,
		}
		const child = this.spawn(spawnOpts)
		s.child = child
		s.cancelRequested = false
		s.detached = false

		let buf = ''
		child.stdout?.setEncoding('utf8')
		child.stdout?.on('data', (chunk: string) => {
			// только текущий ребёнок: события старого процесса после рестарта (modelSet/resume) не текут в новый ход
			if (s.child !== child || s.detached) return
			buf += chunk
			let nl: number
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim()
				buf = buf.slice(nl + 1)
				if (line) this.handleLine(s, line)
			}
		})

		// дренируем stderr (backpressure) и держим ограниченный хвост для диагностики
		child.stderr?.setEncoding('utf8')
		child.stderr?.on('data', (chunk: string) => {
			s.stderrTail = appendStderrTail(s.stderrTail, chunk)
		})

		child.on('exit', (code, signal) => {
			// старый процесс после рестарта (modelSet/sessionResume) не трогаем
			if (s.child !== child || s.detached) return
			s.detached = true
			if (s.turnOpen) {
				// процесс завершился без терминального события хода — гарантируем парность
				s.turnOpen = false
				this.emit(s, { type: 'turn.failed', data: { message: `процесс tclaude завершился (code=${code}, signal=${signal})`, retryable: true, code } })
			}
		})
	}

	private handleLine(s: TclaudeSession, line: string): void {
		if (s.detached) return
		let ev: Record<string, unknown>
		try {
			ev = JSON.parse(line) as Record<string, unknown>
		} catch {
			return // шум/заглушка — не NDJSON
		}
		processLine(s, ev, port => this.emit(s, port))
	}

	/** Пользовательское сообщение в формате stream-json tclaude (как SDKUserMessage nessy): иначе tclaude не примет stdin. */
	private userMessage(sessionId: string, text: string, isMeta = false): Record<string, unknown> {
		return {
			type: 'user',
			...(isMeta ? { isMeta: true } : {}),
			session_id: sessionId,
			message: { role: 'user', content: [{ type: 'text', text }] },
			parent_tool_use_id: null,
		}
	}

	private writeInput(s: TclaudeSession, obj: unknown): void {
		const child = s.child
		if (!child || !child.stdin || child.stdin.destroyed || !child.stdin.writable) {
			throw new AppError(503, 'tclaude_unavailable', 'процесс tclaude недоступен для записи')
		}
		child.stdin.write(JSON.stringify(obj) + '\n')
	}

	/** Жив ли процесс сессии (не завершился и stdin открыт для записи). */
	private isChildAlive(s: TclaudeSession): boolean {
		const c = s.child
		return !!c && c.exitCode === null && c.signalCode === null && !!c.stdin && !c.stdin.destroyed && c.stdin.writable
	}

	/** Переподнять процесс сессии с --resume (контекст сохраняется); старый процесс убиваем, события его не учитываются. */
	private respawn(s: TclaudeSession): void {
		if (s.child) this.killGracefully(s.child, 'SIGTERM')
		s.cancelRequested = false
		this.spawnProcess(s, { resume: true })
	}

	/** Послать сигнал и, если процесс не завершился за grace-таймаут, добить SIGKILL (эскалация, как при close). */
	private killGracefully(child: ChildProcess, signal: NodeJS.Signals): void {
		child.kill(signal)
		const t = setTimeout(() => {
			// завис: exit ещё не наступил — добиваем SIGKILL
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
		}, KILL_GRACE_MS)
		t.unref()
	}

	private requireSession(sessionId: string): TclaudeSession {
		const s = this.sessions.get(sessionId)
		if (!s) throw new AppError(404, 'session_not_found', `сессия ${sessionId} не найдена`)
		return s
	}

	private emit(s: TclaudeSession, port: PortEvent): void {
		s.subscriber?.(this.wrap(s, port))
	}

	private wrap(s: TclaudeSession, port: PortEvent): Envelope {
		s.seq += 1
		return {
			v: 1,
			sessionId: s.id,
			seq: s.seq,
			ts: this.clock.now(),
			originatorClientId: this.originatorClientId,
			type: port.type,
			data: port.data,
		}
	}
}
