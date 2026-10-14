/** Жизненный цикл сессии агента: закрытие по простою и пробуждение (/load), доставка сообщений без прерывания, нехватка места у демона. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import type { Message } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

function setup(idleCloseMs = 30) {
	const store = new MemoryStore()
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs: 3000, idleCloseMs },
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	return { orch, gw }
}
type Ctx = ReturnType<typeof setup>

const replies = (ctx: Ctx): Message[] => ctx.orch.listMessages({ limit: 100 }).filter(m => m.kind === 'reply')

/** Агент с начатым ходом (промпт принят). */
async function working(ctx: Ctx, name = 'alpha'): Promise<string> {
	const r = await ctx.orch.spawn({ space: 'main', name, prompt: 'задача' })
	await until(() => ctx.gw.prompts.length > 0, 2000, 'промпт отправлен')
	await until(() => ctx.orch.getAgent(r.agent.id).status === 'working', 2000, 'ход начат')
	await new Promise(res => setTimeout(res, 5))
	return r.agent.id
}
const finish = (ctx: Ctx, n = 1): void => ctx.gw.emit({ kind: 'text', text: 'готово', messageId: 'm1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: `p-${n}` })

describe('агент: закрытие по простою и пробуждение', () => {
	it('свободный агент паркуется: сессия nessy закрыта, статус не меняется; сообщение поднимает её через /load и подписывается с lastEventId ответа', async () => {
		const ctx = setup(30)
		const id = await working(ctx)
		const nessyId = ctx.orch.resolveAgent(id).nessyId
		finish(ctx)
		await until(() => ctx.gw.closed.includes(nessyId ?? ''), 1000, 'сессия закрыта по простою')
		const parked = ctx.orch.getAgent(id)
		assert.equal(parked.parked, true)
		assert.equal(parked.status, 'idle')

		const r = await ctx.orch.send(id, { text: 'продолжай', from: 'you' })
		assert.equal(r.started, true)
		await until(() => ctx.gw.prompts.length === 2, 1000, 'промпт после пробуждения')
		assert.deepEqual(ctx.gw.restored, [nessyId], 'сессия поднята тем же id, а не создана заново')
		assert.equal(ctx.gw.created, 1)
		assert.equal(ctx.gw.subscribedFrom.at(-1)?.lastEventId, 7, 'подписка с lastEventId из ответа /load — без повтора истории')
		assert.equal(ctx.orch.getAgent(id).parked, false)
	})

	it('сессию не удалось поднять — создаётся новая, в чате пометка о сброшенном контексте', async () => {
		const ctx = setup(30)
		const id = await working(ctx)
		finish(ctx)
		await until(() => ctx.orch.getAgent(id).parked, 1000, 'запаркован')
		ctx.gw.canRestore = false
		await ctx.orch.send(id, { text: 'дальше', from: 'you' })
		await until(() => ctx.gw.prompts.length === 2, 1000, 'промпт после пересоздания')
		assert.equal(ctx.gw.created, 2)
		assert.ok(ctx.orch.agentHistory(id).some(e => e.kind === 'system' && /контекст сброшен/.test(e.text)))
	})

	it('занятого агента не паркуем: есть очередь или нерешённый запрос — сессия остаётся', async () => {
		const ctx = setup(30)
		const id = await working(ctx)
		await ctx.orch.send(id, { text: 'ещё', from: 'you' }) // очередь (mid-turn не принят)
		await new Promise(r => setTimeout(r, 80))
		assert.deepEqual(ctx.gw.closed, [], 'идёт ход — не закрываем')
		finish(ctx, 1)
		await until(() => ctx.gw.prompts.length === 2, 1000, 'второй промпт из очереди')
		assert.deepEqual(ctx.gw.closed, [], 'очередь отработана ходом — таймер взводится заново')
		finish(ctx, 2)
		await until(() => ctx.gw.closed.length === 1, 1000, 'после очереди — закрыта')
	})

	it('idleCloseMs = 0 — не закрываем', async () => {
		const ctx = setup(0)
		const id = await working(ctx)
		finish(ctx)
		await new Promise(r => setTimeout(r, 80))
		assert.equal(ctx.orch.getAgent(id).parked, false)
		assert.deepEqual(ctx.gw.closed, [])
	})

	it('у демона нет места (503): агент ждёт и создаёт сессию, когда место появилось', async () => {
		const ctx = setup(0)
		ctx.gw.busySessions = 2
		const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', prompt: 'задача' })
		await until(() => ctx.gw.prompts.length === 1, 3000, 'промпт после ожидания места')
		assert.equal(ctx.orch.getAgent(r.agent.id).status, 'working')
		assert.ok(ctx.orch.agentHistory(r.agent.id).some(e => e.kind === 'system' && /жду свободное место/.test(e.text)))
	})
})

describe('агент: сообщение работающему не прерывает его', () => {
	it('nessy принял mid-turn: в очередь не встаёт, отмены нет; подтверждение — по событию; ответ получают и вставивший (другой отправитель)', async () => {
		const ctx = setup(0)
		ctx.gw.acceptMidTurn = true
		const id = await working(ctx)
		const other = (await ctx.orch.spawn({ space: 'main', name: 'beta' })).agent.id
		await ctx.orch.send(id, { text: 'уточнение', from: other })
		await until(() => ctx.gw.midTurns.length === 1, 1000, 'сообщение ушло в идущий ход')
		assert.equal(ctx.orch.getAgent(id).queued, 0)
		assert.equal(ctx.gw.cancels, 0)
		assert.match(ctx.gw.midTurns[0] ?? '', /уточнение/)
		ctx.gw.emit({ kind: 'injected', count: 1 })
		finish(ctx)
		await until(() => replies(ctx).filter(m => m.from === id).length === 2, 1000, 'ответ и вставившему')
		const to = replies(ctx).filter(m => m.from === id).map(m => m.to)
		assert.deepEqual(to.sort(), ['you', other].sort())
	})

	it('ход закончился раньше, чем nessy забрал сообщение — оно возвращается в очередь и уходит следующим промптом', async () => {
		const ctx = setup(0)
		ctx.gw.acceptMidTurn = true
		const id = await working(ctx)
		await ctx.orch.send(id, { text: 'не успело', from: 'you' })
		await until(() => ctx.gw.midTurns.length === 1, 1000, 'отправлено в ход')
		finish(ctx) // события injected не было
		await until(() => ctx.gw.prompts.length === 2, 1000, 'сообщение ушло новым промптом')
		assert.match(ctx.gw.prompts[1] ?? '', /не успело/)
	})

	it('interrupt: true по-прежнему прерывает (отмена и срочный промпт)', async () => {
		const ctx = setup(0)
		ctx.gw.acceptMidTurn = true
		const id = await working(ctx)
		await ctx.orch.send(id, { text: 'стоп', from: 'you', interrupt: true })
		assert.equal(ctx.gw.cancels, 1)
		assert.equal(ctx.gw.midTurns.length, 0)
	})
})
