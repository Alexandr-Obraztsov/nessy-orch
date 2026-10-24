/**
 * Типы и чистые хелперы tclaude-адаптера: состояние сессии и маппинг NDJSON → данные конверта.
 * Вынесено из agent-port-tclaude.ts, чтобы держать файл в лимите строк и отделить чистую логику от `this`-методов.
 */
import type { ChildProcess } from 'node:child_process'
import type { ModelVerifyResult, PortEvent, PortEventListener, UnifiedUsage } from '../../application/agent-port'

/** Безопасный дефолт режима разрешений — штатные подтверждения (не bypassPermissions из спайка). */
export const DEFAULT_PERMISSION_MODE = 'default'
/** Сколько ждать SIGINT перед SIGKILL при закрытии сессии. */
export const KILL_GRACE_MS = 2000
/** Ограничение буфера stderr ребёнка (хвост для диагностики, чтобы не копить безгранично). */
export const STDERR_LIMIT = 64 * 1024

export interface TclaudeSession {
	id: string
	child: ChildProcess | null
	homeDir: string
	cwd: string
	model: string | null
	permissionMode: string
	ready: boolean
	seq: number
	text: string
	turnOpen: boolean
	/** отмена запрошена (после SIGINT поздние result/assistant игнорируются — гонка) */
	cancelRequested: boolean
	/** процесс остановлен/заменён: события старого ребёнка больше не обрабатываются */
	detached: boolean
	subscriber: PortEventListener | null
	actualModel: string | null
	verifyResult: ModelVerifyResult | null
	modelSwitchFailedEmitted: boolean
	lastUsage: UnifiedUsage | null
	/** хвост stderr ребёнка (для диагностики ошибок; дренирует поток и ограничен по размеру) */
	stderrTail: string
}

export function newSessionState(id: string, cwd: string, homeDir: string, model: string | null, permissionMode: string): TclaudeSession {
	return {
		id,
		child: null,
		homeDir,
		cwd,
		model,
		permissionMode,
		ready: false,
		seq: 0,
		text: '',
		turnOpen: false,
		cancelRequested: false,
		detached: false,
		subscriber: null,
		actualModel: null,
		verifyResult: null,
		modelSwitchFailedEmitted: false,
		lastUsage: null,
		stderrTail: '',
	}
}

/** Нормализация алиасов моделей: короткое имя → префикс полного id (tclaude `--model opus` отдаёт claude-opus-*). */
const MODEL_ALIASES: Record<string, string> = {
	opus: 'claude-opus',
	sonnet: 'claude-sonnet',
	haiku: 'claude-haiku',
}

export function normalizeModel(model: string | null): string {
	if (!model) return ''
	const m = model.trim()
	return MODEL_ALIASES[m] ?? m
}

/**
 * Сверка фактической модели из system/init с запрошенной; без явной модели проверять нечего — фолбэк рантайма допустим.
 * Алиасы нормализуются (opus→claude-opus*, sonnet→claude-sonnet*), чтобы не было ложных model.switch_failed:
 * фактическая модель сравнивается с запрошенной по нормализованному префиксу.
 */
export function verifyModel(expected: string | null, actual: string | null): ModelVerifyResult {
	if (!expected) return { expected: '', actual, matched: true }
	const exp = normalizeModel(expected)
	const act = actual ?? ''
	const matched = act !== '' && (act === exp || act.startsWith(exp) || normalizeModel(act).startsWith(exp))
	return { expected, actual, matched }
}

/** Склеить текст из content-блоков типа text сообщения assistant. */
export function extractText(msg: { content?: unknown[] } | undefined): string {
	if (!msg || !Array.isArray(msg.content)) return ''
	return msg.content
		.filter((b): b is { type: 'text'; text: string } => {
			if (typeof b !== 'object' || b === null) return false
			const block = b as { type?: unknown; text?: unknown }
			return block.type === 'text' && typeof block.text === 'string'
		})
		.map(b => b.text)
		.join('')
}

export function stopReason(ev: Record<string, unknown>): string {
	const r = ev.stop_reason
	return typeof r === 'string' && r ? r : 'end_turn'
}

/** Текст из stream_event tclaude (content_block_delta / text_delta) — стриминговые дельты, как в nessy-sdk. */
export function extractStreamDelta(ev: Record<string, unknown>): string | null {
	const event = ev.event as { type?: unknown; delta?: { type?: unknown; text?: unknown } } | undefined
	if (event?.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') return null
	const text = event.delta.text
	return typeof text === 'string' && text.length ? text : null
}

/** Дописать chunk к ограниченному хвосту stderr (дренирует поток и не копит безгранично). */
export function appendStderrTail(tail: string, chunk: string): string {
	const next = tail + chunk
	return next.length <= STDERR_LIMIT ? next : next.slice(next.length - STDERR_LIMIT)
}

/**
 * Обработка одной NDJSON-строки tclaude → события порта. Не требует `this`: состояние в `s`, события через `emit`.
 * Маппинг: system/init→верификация модели; stream_event/assistant→message.delta; result→message.completed+turn.completed
 * с UnifiedUsage; error→turn.failed. При `cancelRequested` поздние события игнорируются (гонка после SIGINT).
 */
export function processLine(s: TclaudeSession, ev: Record<string, unknown>, emit: (port: PortEvent) => void): void {
	if (s.detached) return
	const type = ev.type
	if (type === 'system' && ev.subtype === 'init') {
		s.actualModel = (ev.model as string | null | undefined) ?? null
		s.verifyResult = verifyModel(s.model, s.actualModel)
		emitModelSwitchFailedIfNeeded(s, emit)
		return
	}
	if (type === 'stream_event') {
		if (s.cancelRequested) return
		const delta = extractStreamDelta(ev)
		if (!delta) return
		s.text += delta
		emit({ type: 'message.delta', data: { messageId: null, text: delta } })
		return
	}
	if (type === 'assistant') {
		if (s.cancelRequested) return
		const text = extractText(ev.message as { content?: unknown[] } | undefined)
		if (!text) return
		// дедуп по content-блоку (не по пустоте s.text): много-assistant-ход не теряет блоки, а дельты+финал
		// не дублируют текст (дописываем только недостающий хвост блока)
		let rest = text
		const cur = s.text
		if (cur) {
			if (text.startsWith(cur)) rest = text.slice(cur.length)
			else if (cur.endsWith(text)) return
		}
		if (!rest) return
		s.text += rest
		emit({ type: 'message.delta', data: { messageId: null, text: rest } })
		return
	}
	if (type === 'result') {
		if (s.cancelRequested) return // поздний result после отмены — игнорируем, терминал уже синтезирован
		s.lastUsage = toUsage(ev)
		if (s.text) {
			emit({ type: 'message.completed', data: { messageId: null, text: s.text } })
			s.text = ''
		}
		s.turnOpen = false
		emit({ type: 'turn.completed', data: { stopReason: stopReason(ev), promptId: null } })
		emit({ type: 'context.usage', data: { used: s.lastUsage.totalTokens ?? 0, size: 0 } })
		return
	}
	if (type === 'error') {
		if (s.cancelRequested) return
		s.turnOpen = false
		emit({ type: 'turn.failed', data: { message: errorMessage(ev), retryable: false, code: null } })
	}
}

/** При расхождении фактической модели с ожидаемой — одноразовый model.switch_failed. */
export function emitModelSwitchFailedIfNeeded(s: TclaudeSession, emit: (port: PortEvent) => void): void {
	if (s.modelSwitchFailedEmitted || !s.verifyResult || s.verifyResult.matched) return
	s.modelSwitchFailedEmitted = true
	const { expected, actual } = s.verifyResult
	emit({
		type: 'model.switch_failed',
		data: { expected, actual, message: `tclaude запустился на модели ${actual ?? 'неизвестной'}, а не на ${expected}` },
	})
}

export function errorMessage(ev: Record<string, unknown>): string {
	const e = ev.error
	if (typeof e === 'string') return e
	if (e && typeof e === 'object') {
		const m = (e as { message?: unknown }).message
		if (typeof m === 'string') return m
	}
	return 'ошибка рантайма tclaude'
}

/** UnifiedUsage из полей result tclaude; отсутствующие числовые поля — null/0. */
export function toUsage(ev: Record<string, unknown>): UnifiedUsage {
	const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
	return {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: num(ev.total_tokens) ?? null,
		costUsd: num(ev.total_cost_usd) ?? null,
		numTurns: num(ev.num_turns) ?? 0,
		durationMs: num(ev.duration_ms) ?? null,
	}
}

/** Привести неизвестный rejected-причину к Error (useUnknownInCatchVariables + prefer-promise-reject-errors). */
export function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'ошибка рантайма tclaude')
}
