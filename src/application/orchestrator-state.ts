/**
 * Состояние оркестратора ↔ хранилище: снимок для записи и восстановление агентов при старте.
 * Выделено из orchestrator.ts по единой ответственности — «сериализация состояния».
 */
import { Agent } from './agent/agent'
import type { AgentDeps } from './agent/agent.types'
import type { PersistedAgent, PersistedState } from './persisted.types'
import type { Registry } from './registry'
import type { SessionsService } from './services/sessions.service'

export function snapshotState(registry: Registry, msgSeq: number): PersistedState {
	return {
		spaces: [...registry.spaces.values()].map(s => ({ name: s.name, path: s.path, url: s.url, color: s.color, runtime: s.runtime, model: s.model })),
		agents: [...registry.agents.values()].map(a => a.persist()),
		msgSeq,
	}
}

/** Агенты из состояния в реестр: пропавшее пространство и пропавшая сессия не теряют агента (чат и ответы сохраняются). */
export function restoreAgents(persisted: readonly PersistedAgent[], registry: Registry, sessions: SessionsService, deps: AgentDeps): void {
	for (const p of persisted) {
		// пространство пропало из состояния: агент остаётся, а статус — ошибка с причиной
		const lost = !registry.spaces.has(p.space)
		// старые состояния без сессии и ссылки на пропавшую сессию → вне сессий
		const session = p.session && sessions.has(p.session) ? p.session : null
		const agent = Agent.restore({ ...p, session }, deps)
		if (lost) agent.markLost(`пространство «${p.space}» не найдено — агент недоступен, пока оно не добавлено снова`)
		registry.agents.set(p.id, agent)
	}
}
