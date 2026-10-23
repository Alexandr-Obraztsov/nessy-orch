/**
 * Ход агента: доставка сообщений, очередь, промпт, отмена, повторы, завершение хода.
 * Выделено из agent.ts по единой ответственности — «очередь/ход»; состояние агента передаётся параметром (AgentState).
 */
import { archiveAfterTurn, statusAfterTurn } from '../../domain/agent-status'
import { USER, YOU } from '../../domain/constants'
import { NessyBusyError } from '../../domain/errors'
import { planOnTurnStart } from '../../domain/plan'
import { planReminder } from '../../domain/preamble'
import { framePrompt } from '../../domain/routing'
import type { TurnOutcome } from '../../domain/types'
import { errMsg } from '../../lib/json'
import { clip } from '../../lib/text'
import type { AgentPort } from '../agent-port'
import { ensureAttached, scheduleIdleClose } from './agent-connection'
import { PROMPT_RETRY_BASE_MS, PROMPT_RETRY_MAX, PROMPT_RETRY_MAX_DELAY_MS } from './agent-retry'
import type { AgentState, CurrentTurn } from './agent.types'
import type { Message } from '../../../shared/types'

/** Доставить сообщение: агент выходит из архива. interrupt — срочно: встать впереди очереди и прервать текущий ход. */
export function deliver(a: AgentState, msg: Message, interrupt = false): void {
	if (a.removed) {
		a.noteReply(a.deps.callbacks.onTurnDone(a, msg, '', { error: 'агент удалён' }))
		return
	}
	a.archived = false
	a.clearIdleTimer()
	// работающему агенту сообщение не мешает: уходит в идущий ход (mid-turn-message); не приняли — встанет в очередь
	if (!interrupt && canInject(a)) {
		void inject(a, msg)
		return
	}
	if (interrupt) {
		a.queue.splice(a.urgent, 0, msg)
		a.urgent++
	} else {
		a.queue.push(msg)
	}
	a.publishNode()
	if (interrupt && a.current) {
		void requestCancel(a)
		return
	}
	void pump(a)
}

function canInject(a: AgentState): boolean {
	const cur = a.current
	return cur !== null && cur.sent && !cur.cancelRequested && a.nessyId !== null && a.queue.length === 0
}

async function inject(a: AgentState, msg: Message): Promise<void> {
	const turn = a.current
	const client = a.deps.callbacks.getSpace(a.space)?.client
	let ok = false
	if (turn && client && a.nessyId) ok = await client.midTurnSend(a.nessyId, framePrompt(msg, a.deps.callbacks.labelOf(msg.from))).catch(() => false)
	if (ok && a.current === turn && turn) {
		turn.injected.push({ msg, confirmed: false })
		a.touch()
		a.publishNode()
		return
	}
	// ход уже закончился или nessy не принял сообщение — обычная очередь
	a.queue.push(msg)
	a.publishNode()
	void pump(a)
}

/** Продолжить доставку очереди (после восстановления из состояния). */
export function resumeQueue(a: AgentState): void {
	const lost = a.lostTurn
	if (lost) {
		// ход «в полёте» при остановке теряется: сообщаем об этом отправителю (в том числе ждущему --wait) и в чат
		a.lostTurn = null
		const reason = 'оркестратор был перезапущен во время хода'
		a.addSystem(`${reason}: ответа не будет`, 'error')
		a.setStatus('error', reason)
		a.noteReply(a.deps.callbacks.onTurnDone(a, lost, '', { error: reason }))
		a.publishNode()
	}
	if (a.queue.length) void pump(a)
}

async function pump(a: AgentState): Promise<void> {
	if (a.current || a.pumping || a.removed || a.holdPump) return
	if (!a.queue.length) return
	a.pumping = true
	try {
		await ensureAttached(a)
	} catch (e) {
		a.pumping = false
		// нет соединения с nessy: поручение повторяем с паузой, как и после ошибки хода
		const first = a.queue[0]
		const retry = first ? planRetry(a, first.id, errMsg(e), false) : null
		if (retry) {
			a.addSystem(
				`не удалось подключиться к nessy: ${errMsg(e)} — повтор ${retry.n}/${a.deps.turnRetries ?? 0} через ${Math.round(retry.delayMs / 1000)} с`,
				'error',
			)
			armRetry(a, retry.delayMs)
			return
		}
		const failed = a.queue.splice(0)
		a.urgent = 0
		for (const m of failed) a.noteReply(a.deps.callbacks.onTurnDone(a, m, '', { error: errMsg(e) }))
		if (failed.length) a.publishNode()
		return
	}
	a.pumping = false
	if (a.isBusy) return
	const msg = a.queue.shift()
	if (!msg) return
	if (a.urgent > 0) a.urgent--

	a.current = {
		msg,
		promptId: null,
		texts: [],
		textMsgId: null,
		textBreak: false,
		planned: false,
		planWarned: false,
		startedAt: new Date(a.deps.clock.now()).toISOString(),
		startedMs: a.deps.clock.now(),
		error: null,
		cancelRequested: false,
		sent: false,
		injected: [],
	}
	a.journal.resetTools()
	a.turnSteps = 0
	// новая сессия от оператора после выполненного плана — план сбрасывается (уточнения его сохраняют)
	a.plan = planOnTurnStart(a.plan, msg.from === YOU || msg.from === USER, a.queue.length)
	a.setStatus('working')
	a.journal.add({ kind: 'user', from: msg.from, msgId: msg.id, text: msg.text })
	try {
		const client = a.deps.callbacks.getSpace(a.space)?.client
		if (!client || !a.nessyId) throw new Error('нет соединения с nessy')
		const { promptId } = await promptWithRetry(a, client, a.nessyId, msg)
		a.introduced = true
		const turn = turnFor(a, msg)
		if (!turn) {
			// ход закрыли (отмена без подтверждения, удаление), пока промпт летел: nessy его всё же принял — его события игнорируем, а сам он отменяется
			if (promptId) a.rememberDone(promptId)
			void sendCancel(a)
			return
		}
		a.staleEvents = false // nessy принял новый промпт — дальше события его
		turn.promptId = promptId
		turn.sent = true
		if (turn.cancelRequested) await sendCancel(a) // прервали, пока промпт летел в nessy
	} catch (e) {
		if (turnFor(a, msg)) finishTurn(a, { error: errMsg(e) })
	}
}

/**
 * Отправить промпт; на временный отказ nessy (очередь переполнена, 429, сессия занята) ждём и повторяем
 * с растущей паузой (или Retry-After), пока ход не отменили. Окончательная ошибка пробрасывается.
 */
async function promptWithRetry(a: AgentState, client: AgentPort, sessionId: string, msg: Message): Promise<{ promptId: string | null }> {
	const base = a.deps.promptRetryBaseMs ?? PROMPT_RETRY_BASE_MS
	for (let attempt = 0; ; attempt++) {
		try {
			return await client.promptSend(sessionId, buildPrompt(a, msg))
		} catch (e) {
			const cur = turnFor(a, msg)
			if (!(e instanceof NessyBusyError) || attempt >= PROMPT_RETRY_MAX || !cur || cur.cancelRequested) throw e
			const delay = Math.min(e.retryAfterMs ?? base * 2 ** attempt, PROMPT_RETRY_MAX_DELAY_MS)
			if (attempt === 0) a.addSystem(`nessy занят (${e.reason}) — повторю отправку`)
			await new Promise<void>(resolve => setTimeout(resolve, delay).unref())
		}
	}
}

/** Текущий ход, если он всё ещё по этому сообщению (ход мог завершиться, пока ждали nessy). */
function turnFor(a: AgentState, msg: Message): CurrentTurn | null {
	return a.current?.msg === msg ? a.current : null
}

function buildPrompt(a: AgentState, msg: Message): string {
	const callbacks = a.deps.callbacks
	let body = framePrompt(msg, callbacks.labelOf(msg.from))
	// повтор после ошибки: модель знает, что предыдущая попытка оборвалась, и не повторяет уже сделанное
	if (a.retryState?.id === msg.id) {
		body = `[nessy-orch] Прошлая попытка выполнить это поручение оборвалась ошибкой: «${clip(a.retryState.error, 300)}». Продолжи с того места, где остановился. Уже выполненные действия (особенно записи во внешние системы: комментарии, правки, коммиты) не повторяй: сначала проверь текущее состояние.\n\n${body}`
	}
	// правила плана — в вводной первого промпта; напоминание повторяем только там: у агентов малое окно контекста, каждая строка в каждом ходе копится
	return a.introduced ? body : `${callbacks.preambleFor(a)}\n\n${body}\n\n${planReminder(a.id, a.deps.cliPath, a.deps.showKey ? a.key : undefined)}`
}

/** Прервать ход и очистить очередь. */
export async function cancel(a: AgentState): Promise<void> {
	// сброшенные сообщения (очередь и не забранные моделью mid-turn): отправителей, которые ждут ответа (--wait), не оставляем до таймаута
	const dropped = [...a.queue, ...(a.current?.injected.filter(i => !i.confirmed).map(i => i.msg) ?? [])]
	a.queue = []
	a.urgent = 0
	if (a.holdPump) {
		// шла пауза перед повтором: поручение отменено, повторять нечего
		a.holdPump = false
		a.retryState = null
		if (!a.current) a.setStatus('idle')
	}
	if (a.current) a.current.injected = a.current.injected.filter(i => i.confirmed)
	for (const m of dropped) if (m.wait) a.noteReply(a.deps.callbacks.onTurnDone(a, m, '', { stopReason: 'cancelled' }))
	a.publishNode()
	await requestCancel(a)
}

/**
 * Запросить отмену текущего хода. Ход завершится по событию nessy (cancelled/turn_complete);
 * если подтверждения нет за cancelGraceMs — завершаем сами, а поздние события старого промпта игнорируем.
 */
async function requestCancel(a: AgentState): Promise<void> {
	const cur = a.current
	if (!cur || cur.cancelRequested) return
	cur.cancelRequested = true
	a.cancelTimer = setTimeout(() => {
		a.cancelTimer = null
		if (a.current !== cur) return
		a.staleEvents = true
		a.addSystem('nessy не подтвердил отмену — продолжаю без подтверждения')
		finishTurn(a, { stopReason: 'cancelled' })
	}, a.deps.cancelGraceMs)
	a.cancelTimer.unref()
	if (cur.sent) await sendCancel(a)
}

export async function sendCancel(a: AgentState): Promise<void> {
	const client = a.deps.callbacks.getSpace(a.space)?.client
	if (client && a.nessyId) await client.promptCancel(a.nessyId).catch(() => undefined)
}

/** Закрыть ход: подвести статистику, ответить отправителю, решить про архив/повтор/следующее сообщение. */
export function finishTurn(a: AgentState, outcome: TurnOutcome): void {
	const cur = a.current
	if (!cur) return
	a.current = null
	a.lastTurnMs = Math.max(0, a.deps.clock.now() - cur.startedMs)
	a.stats = {
		turns: a.stats.turns + 1,
		toolCalls: a.stats.toolCalls + a.turnSteps,
		workMs: a.stats.workMs + a.lastTurnMs,
		tokens: a.stats.tokens,
		...a.contextMetric(),
	}
	a.clearCancelTimer()
	if (cur.promptId) a.rememberDone(cur.promptId)
	a.journal.flushRun()
	const info: TurnOutcome = { ...outcome }
	if (!info.error && cur.error) info.error = cur.error
	const cancelled = info.stopReason === 'cancelled'
	if (info.error || cancelled) a.journal.failOpenTools()
	// запросы разрешений, не решённые до конца хода, больше не актуальны
	a.pending.clear()
	// результат хода — только финальное сообщение: последний непустой блок текста
	const text = finalText(cur.texts)
	if (text) a.lastReply = text
	// ошибка хода: повторяем то же поручение (2 раза с растущей паузой), ответ с ошибкой — только когда повторы кончились
	const retry = planRetry(a, cur.msg.id, info.error, cancelled || cur.cancelRequested)
	if (info.error)
		a.addSystem(
			'ход завершился ошибкой: ' + info.error + (retry ? ` — повтор ${retry.n}/${a.deps.turnRetries ?? 0} через ${Math.round(retry.delayMs / 1000)} с` : ''),
			'error',
		)
	else if (cancelled) a.addSystem('ход прерван')
	if (!info.error) a.retryState = null
	if (retry) {
		holdRetry(a, cur, retry.delayMs)
		return
	}
	const queued = a.queue.length
	if (archiveAfterTurn(info, queued)) a.archived = true
	a.setStatus(statusAfterTurn(info, queued), info.error ?? null)
	if (a.noteReply(a.deps.callbacks.onTurnDone(a, cur.msg, text, info))) a.publishNode()
	// сообщения, доставленные в ход без прерывания: тому же отправителю отдельный ответ не нужен, остальным (и ждущим --wait) — нужен
	const unseen: Message[] = []
	for (const { msg: m, confirmed } of cur.injected) {
		if (!confirmed)
			unseen.push(m) // ход закончился раньше, чем nessy забрал сообщение: модель его не видела
		else if (m.from !== cur.msg.from || m.wait) a.noteReply(a.deps.callbacks.onTurnDone(a, m, text, info))
	}
	if (unseen.length) {
		a.queue.splice(a.urgent, 0, ...unseen) // после срочных, но раньше обычной очереди
		a.publishNode()
	}
	void pump(a)
	scheduleIdleClose(a)
}

/** Нужен ли повтор: любая ошибка (кроме отмены), агент жив и повторы не исчерпаны. */
function planRetry(a: AgentState, msgId: string, error: string | undefined, noRetry: boolean): { n: number; delayMs: number } | null {
	const max = a.deps.turnRetries ?? 0
	if (!error || noRetry || a.removed || max <= 0) return null
	const n = (a.retryState?.id === msgId ? a.retryState.n : 0) + 1
	if (n > max) {
		a.retryState = null
		return null
	}
	a.retryState = { id: msgId, n, error }
	return { n, delayMs: (a.deps.turnRetryBaseMs ?? 3000) * 2 ** (n - 1) }
}

/** Вернуть поручение в начало очереди и разобрать её после паузы; сообщения, доставленные в тот же ход, идут следом. */
function holdRetry(a: AgentState, cur: CurrentTurn, delayMs: number): void {
	a.queue.unshift(cur.msg)
	a.urgent++
	a.queue.splice(a.urgent, 0, ...cur.injected.map(i => i.msg))
	armRetry(a, delayMs)
}

/** Пауза перед повтором: очередь не разбирается, агент считается работающим. */
function armRetry(a: AgentState, delayMs: number): void {
	a.holdPump = true
	a.setStatus('working')
	a.publishNode()
	setTimeout(() => {
		a.holdPump = false
		void pump(a)
	}, delayMs).unref()
}

/** Последний непустой блок текста хода (промежуточные комментарии между инструментами в ответ не входят). */
function finalText(texts: readonly string[]): string {
	for (let i = texts.length - 1; i >= 0; i--) {
		const t = (texts[i] ?? '').trim()
		if (t) return t
	}
	return ''
}
