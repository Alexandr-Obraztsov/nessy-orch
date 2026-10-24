/**
 * Восстановление агента из сохранённого состояния: поля, которые Agent не получает через конструктор.
 * Выделено из agent.ts по единой ответственности; состояние агента передаётся параметром (AgentState).
 */
import type { PersistedAgent } from '../persisted.types'
import type { AgentState } from './agent.types'

export function applyPersisted(a: AgentState, p: PersistedAgent): void {
	// агент из состояния без ключа получает новый и снова «представляется» (вводная содержит ключ)
	if (!p.key) a.introduced = false
	a.createdAt = p.createdAt
	a.nessyId = p.sessionId
	a.modelActual = p.modelActual ?? null
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
}
