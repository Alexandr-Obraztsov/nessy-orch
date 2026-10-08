/** Жизненный цикл агентов: создание, удаление, прерывание, разрешения, история чата. */
import type { AgentEvent, AgentView, Message, SendResponse, SpawnRequest, SpawnResponse } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { buildPreamble } from '../../domain/preamble'
import type { AgentIdentity } from '../../domain/types'
import { Agent } from '../agent/agent'
import type { ServiceContext } from './context.types'
import type { MessagingService } from './messaging.service'
import type { SpacesService } from './spaces.service'

export class AgentsService {
	constructor(
		private readonly ctx: ServiceContext,
		private readonly spaces: SpacesService,
		private readonly messaging: MessagingService,
	) {}

	/** Вводная для нового контекста агента. */
	preambleFor(agent: AgentIdentity): string {
		const peers = [...this.ctx.registry.agents.values()].filter(a => a.id !== agent.id && a.status !== 'dead')
		return buildPreamble(agent, peers, this.ctx.settings.cliPath)
	}

	async spawn(req: SpawnRequest): Promise<SpawnResponse> {
		const { registry } = this.ctx
		const space = this.spaces.resolve(req.space)
		const from = registry.resolveSender(req.from)
		const parent = req.parent ?? from
		let id: string
		do id = 'a-' + this.ctx.ids.next(4)
		while (registry.agents.has(id))
		const name = req.name?.trim() || id
		if (registry.isNameTaken(name)) throw new AppError(409, 'name_taken', `имя «${name}» уже занято`)

		const agent = new Agent({ id, name, space: space.name, parent }, this.ctx.agentDeps)
		registry.agents.set(id, agent)
		agent.addSystem(`агент создан в пространстве «${space.name}» (${space.path})`)
		agent.publishNode()
		this.messaging.postEvent(`${registry.labelOf(from)} создал агента ${registry.labelOf(id)}`, id)

		let res: SendResponse | undefined
		if (req.prompt?.trim()) {
			res = await this.messaging.send(id, { from, text: req.prompt, wait: req.wait, waitTimeoutSec: req.waitTimeoutSec })
		} else {
			void agent.ensureAttached().catch(() => undefined)
		}
		const out: SpawnResponse = { agent: agent.toJSON(), message: res?.message as Message }
		if (res?.reply) out.reply = res.reply
		if (res?.timedOut) out.timedOut = true
		return out
	}

	async remove(ref: string): Promise<void> {
		const { registry } = this.ctx
		const agent = registry.resolveAgent(ref)
		await agent.cancel().catch(() => undefined)
		await agent.close().catch(() => undefined)
		registry.agents.delete(agent.id)
		this.messaging.forget(agent.id)
		this.ctx.store.archiveAgent(agent.id)
		this.ctx.hub.publish({ t: 'agent_removed', id: agent.id })
		this.messaging.postEvent(`агент ${registry.labelOf(agent.id)} удалён`, agent.id)
		this.ctx.saveSoon()
	}

	async cancel(ref: string): Promise<AgentView> {
		const agent = this.ctx.registry.resolveAgent(ref)
		await agent.cancel()
		return agent.toJSON()
	}

	resolvePermission(ref: string, requestId: string, approve: boolean): Promise<boolean> {
		return this.ctx.registry.resolveAgent(ref).resolvePermission(requestId, approve)
	}

	/**
	 * История чата агента: события из хранилища (последняя запись с тем же seq побеждает).
	 * includeLive — добавить незавершённый блок текста (для REST); поток отдаёт его отдельным chunk.
	 */
	history(ref: string, limit = 400, includeLive = true): AgentEvent[] {
		const agent = this.ctx.registry.resolveAgent(ref)
		const bySeq = new Map<number, AgentEvent>()
		for (const e of this.ctx.store.readEvents(agent.id, 4000)) bySeq.set(e.seq, e)
		const live = agent.liveRun()
		if (live) {
			if (includeLive) bySeq.set(live.seq, { seq: live.seq, ts: live.ts, kind: live.kind, text: live.text })
			else bySeq.delete(live.seq)
		}
		return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-limit)
	}
}
