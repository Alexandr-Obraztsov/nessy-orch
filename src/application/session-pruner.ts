/**
 * Уборка старых сессий: сверх `maxSessions` удаляем самые давние простаивающие сессии вместе с их агентами.
 * Выделено из orchestrator.ts по единой ответственности — «жизненный цикл сессий»; оркестратор лишь делегирует.
 */
import type { Agent } from './agent/agent'
import type { Registry } from './registry'
import type { AgentsService } from './services/agents.service'
import type { SessionsService } from './services/sessions.service'
import type { ServiceContext } from './services/context.types'
import type { SessionView } from '../../shared/types'

/** Сессия, в которой что-то происходило недавно, при уборке не удаляется */
const SESSION_FRESH_MS = 30 * 60_000

export class SessionPruner {
	private pruning: Promise<number> | null = null

	constructor(
		private readonly registry: Registry,
		private readonly ctx: ServiceContext,
		private readonly sessionsSvc: SessionsService,
		private readonly agentsSvc: AgentsService,
		private readonly removeSession: (id: string) => void,
	) {}

	/**
	 * Не держим много сессий: сверх `maxSessions` удаляем самые давние, в которых никто не работает и ничего не происходило последние
	 * полчаса, вместе с их (простаивающими) агентами. Свежие и работающие не трогаем: лимит может быть временно превышен.
	 */
	prune(keepId: string): Promise<number> {
		// одна уборка за раз: две параллельные видели бы одни и те же «лишние» сессии и удалили бы лишнее
		const run = (this.pruning ?? Promise.resolve(0)).then(() => this.pruneOnce(keepId))
		this.pruning = run.catch(() => 0)
		return run
	}

	private async pruneOnce(keepId: string): Promise<number> {
		const max = this.ctx.settings.maxSessions ?? 10
		const now = this.ctx.clock.now()
		const agentsOf = (id: string): Agent[] => [...this.registry.agents.values()].filter(a => a.session === id)
		const lastActivity = (s: SessionView): number => Math.max(Date.parse(s.updatedAt), ...agentsOf(s.id).map(a => Date.parse(a.lastActivityAt)))
		const candidates = this.sessionsSvc
			.list()
			.filter(s => s.id !== keepId && agentsOf(s.id).every(a => !a.isBusy && a.queue.length === 0) && now - lastActivity(s) > SESSION_FRESH_MS)
			.sort((a, b) => lastActivity(a) - lastActivity(b))
		let removed = 0
		for (const s of candidates) {
			if (this.sessionsSvc.list().length <= max) break // число пересчитывается по живым данным
			if (!this.sessionsSvc.has(s.id)) continue
			for (const a of agentsOf(s.id)) await this.agentsSvc.remove(a.id).catch(() => undefined)
			try {
				this.removeSession(s.id)
				removed++
			} catch {
				/* сессия снова занята — пропускаем */
			}
		}
		return removed
	}
}
