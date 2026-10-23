/**
 * Подключение агента к nessy: создать/поднять сессию, подписаться на события, парковка по простою.
 * Выделено из agent.ts по единой ответственности — «подключение»; состояние агента передаётся параметром (AgentState).
 */
import { statusAfterAttach } from '../../domain/agent-status'
import { NessyBusyError } from '../../domain/errors'
import { errMsg } from '../../lib/json'
import { PROMPT_RETRY_BASE_MS, PROMPT_RETRY_MAX_DELAY_MS, SESSION_RETRY_MAX } from './agent-retry'
import type { AgentState } from './agent.types'

/** Подключить агента: создать (или поднять) сессию и подписаться на события. */
export function ensureAttached(a: AgentState): Promise<void> {
	if (a.sub) return Promise.resolve()
	a.attaching ??= attach(a)
		.catch((e: unknown) => {
			a.setStatus('error', errMsg(e))
			a.addSystem('не удалось подключиться к nessy: ' + errMsg(e), 'error')
			throw e
		})
		.finally(() => {
			a.attaching = null
		})
	return a.attaching
}

async function attach(a: AgentState): Promise<void> {
	const space = a.deps.callbacks.getSpace(a.space)
	if (!space) throw new Error(`пространство «${a.space}» не найдено`)
	const client = await space.ensureReady()
	await a.closing // сессию закрывали по простою: поднимать её можно только после закрытия
	const prev = a.resume ? a.nessyId : null
	// с какого события подписываться: у поднятой сессии — с последнего seq из ответа резюма (повтор истории не нужен), у новой — с начала
	let cursor = a.lastEventId
	let resumed = false
	if (prev !== null) {
		const r = await whenNessyFree(a, () => client.sessionResume(prev, space.path))
		if (r) {
			resumed = true
			cursor = r.lastSeq ?? cursor
		}
	}
	if (!resumed) {
		const hadSession = a.nessyId !== null
		// сначала заготовка из пула: создание сессии nessy — самая долгая часть запуска агента
		const warm = a.deps.callbacks.takeWarmSession(a.space)
		const sessionId = warm ?? (await whenNessyFree(a, () => client.sessionCreate(space.path))).sessionId
		a.nessyId = sessionId
		cursor = null
		a.lastEventId = null
		a.introduced = false // новый контекст — снова представиться
		if (hadSession)
			a.addSystem(prev !== null ? 'сессию nessy не удалось восстановить — создана новая, контекст сброшен' : 'сессия nessy пересоздана, контекст сброшен')
	}
	a.resume = false
	a.parked = false
	a.sub = client.subscribe(a.nessyId ?? '', {
		lastSeq: cursor,
		onEvent: envelope => a.handlePortEvent(envelope),
	})
	const next = statusAfterAttach(a.status)
	if (next !== a.status) a.setStatus(next)
	else a.publishNode()
}

/**
 * Вызов nessy, который при нехватке места (лимит сессий демона, 503) или гонке restore (409) стоит переждать:
 * ждём Retry-After и повторяем несколько раз, агент остаётся «запускается».
 */
async function whenNessyFree<T>(a: AgentState, fn: () => Promise<T>): Promise<T> {
	const base = a.deps.promptRetryBaseMs ?? PROMPT_RETRY_BASE_MS
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn()
		} catch (e) {
			if (!(e instanceof NessyBusyError) || attempt >= SESSION_RETRY_MAX) throw e
			if (attempt === 0) a.addSystem(`nessy занят (${e.reason}) — жду свободное место`)
			await new Promise<void>(resolve => setTimeout(resolve, Math.min(e.retryAfterMs ?? base * 2 ** attempt, PROMPT_RETRY_MAX_DELAY_MS)).unref())
		}
	}
}

/** Отцепить агента от сессии: закрыть подписку и таймеры (session nessy не трогаем). */
export function detach(a: AgentState): void {
	a.sub?.close()
	a.sub = null
	a.clearCancelTimer()
	a.clearIdleTimer()
}

/** Свободного агента закроем через idleCloseMs. */
export function scheduleIdleClose(a: AgentState): void {
	a.clearIdleTimer()
	const ms = a.deps.idleCloseMs
	if (ms <= 0 || !a.sub || a.current || a.queue.length || a.pumping) return
	a.idleTimer = setTimeout(() => {
		a.idleTimer = null
		void park(a)
	}, ms)
	a.idleTimer.unref()
}

/**
 * Закрыть сессию nessy у свободного агента: подписка закрывается, DELETE освобождает слот демона, контекст остаётся на диске.
 * Не трогаем агента, у которого есть ход, очередь или нерешённые запросы разрешений.
 */
export async function park(a: AgentState): Promise<void> {
	if (a.current || a.queue.length || a.pumping || a.pending.size || !a.sub || !a.nessyId) return
	const id = a.nessyId
	const client = a.deps.callbacks.getSpace(a.space)?.client
	detach(a)
	a.resume = true
	a.parked = true
	a.publishNode()
	if (!client) return
	a.closing = client
		.sessionClose(id)
		.catch(() => undefined)
		.finally(() => {
			a.closing = null
		})
	await a.closing
}
