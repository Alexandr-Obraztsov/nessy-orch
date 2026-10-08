/**
 * Машина состояний агента (чистые функции):
 *
 *   starting → idle ⇄ working → (idle | error)
 *
 * Состояний сна и смерти нет: восстановленный из state.json агент — idle (сессия nessy поднимается лениво,
 * при первом сообщении), упавшая сессия — error (следующее сообщение создаёт новую).
 * Архив (archived) — отдельный флаг: успешно закончив работу, агент скрывается из рабочего списка.
 */
import type { AgentStatus } from '../../shared/types'
import type { TurnOutcome } from './types'

const STATUSES: readonly AgentStatus[] = ['starting', 'working', 'idle', 'error']

export function isAgentStatus(s: string): s is AgentStatus {
	return (STATUSES as readonly string[]).includes(s)
}

/** Статус после восстановления из состояния: всегда idle (подключение — при первом сообщении). */
export function restoredStatus(): AgentStatus {
	return 'idle'
}

/** Статус после успешного подключения к сессии nessy. */
export function statusAfterAttach(current: AgentStatus): AgentStatus {
	return current === 'starting' || current === 'error' ? 'idle' : current
}

/** Ход завершился успешно (не ошибкой и не прерыванием). */
export function turnSucceeded(outcome: TurnOutcome): boolean {
	return !outcome.error && outcome.stopReason !== 'cancelled'
}

/** Статус после завершения хода: в очереди есть сообщения — работаем дальше; ошибка — error. */
export function statusAfterTurn(outcome: TurnOutcome, queued: number): AgentStatus {
	if (queued > 0) return 'working'
	return outcome.error ? 'error' : 'idle'
}

/** Уходит ли агент в архив после хода: задача выполнена и больше ничего не ждёт. */
export function archiveAfterTurn(outcome: TurnOutcome, queued: number): boolean {
	return turnSucceeded(outcome) && queued === 0
}
