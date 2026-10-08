/**
 * Машина состояний агента (чистые функции):
 *
 *   starting → idle ⇄ working → (error | dead);  sleeping — восстановлен из state.json, ещё не подключён.
 */
import type { AgentStatus } from '../../shared/types'

const STATUSES: readonly AgentStatus[] = ['starting', 'idle', 'working', 'error', 'dead', 'sleeping']

export function isAgentStatus(s: string): s is AgentStatus {
	return (STATUSES as readonly string[]).includes(s)
}

/** Статус после восстановления из состояния: dead остаётся dead, остальные «спят» до первого обращения. */
export function restoredStatus(persisted: string): AgentStatus {
	return persisted === 'dead' ? 'dead' : 'sleeping'
}

/** Статус после успешного подключения к сессии nessy. */
export function statusAfterAttach(current: AgentStatus): AgentStatus {
	return current === 'starting' || current === 'sleeping' || current === 'error' ? 'idle' : current
}

/** Статус после завершения хода: в очереди есть сообщения — работаем дальше. */
export function statusAfterTurn(current: AgentStatus, queued: number): AgentStatus {
	if (current === 'dead') return 'dead'
	return queued > 0 ? 'working' : 'idle'
}

/** Можно ли доставлять сообщения агенту. */
export function canReceive(status: AgentStatus): boolean {
	return status !== 'dead'
}
