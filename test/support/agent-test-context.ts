/** Общий стенд unit-тестов агента: оркестратор на поддельном шлюзе и хелперы чтения истории/ответов. */
import * as os from 'node:os'
import type { AgentEvent, HubEvent, Message } from '../../shared/types'
import { Orchestrator } from '../../src/application/orchestrator'
import { FakeAgentPort, FakeSpace, MemoryStore } from './memory-store'
import { until } from './wait'

export interface Ctx {
	orch: Orchestrator
	gw: FakeAgentPort
	store: MemoryStore
	hub: HubEvent[]
}

export function setup(autoApprove = true, cancelGraceMs = 3000): Ctx {
	const store = new MemoryStore()
	const gw = new FakeAgentPort({ autoRespond: false })
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs },
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const hub: HubEvent[] = []
	orch.hub.subscribe(e => hub.push(e))
	return { orch, gw, store, hub }
}

/** История агента (как читает её конечный пользователь). */
export function history(ctx: Ctx, id: string): AgentEvent[] {
	return ctx.orch.agentHistory(id)
}

export const replies = (ctx: Ctx): Message[] => ctx.orch.listMessages({ limit: 100 }).filter(m => m.kind === 'reply')

export const users = (ctx: Ctx, id: string): string[] => history(ctx, id).flatMap(e => (e.kind === 'user' ? [e.text] : []))

export async function startTurn(ctx: Ctx, text = 'сессия'): Promise<string> {
	const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', prompt: text })
	await until(() => ctx.gw.prompts.length > 0, 2000, 'промпт отправлен')
	await until(() => ctx.orch.resolveAgent('alpha').currentMessage !== null && ctx.orch.resolveAgent('alpha').status === 'working', 2000, 'ход начат')
	await new Promise(r => setTimeout(r, 5)) // дать установиться promptId
	return r.agent.id
}
