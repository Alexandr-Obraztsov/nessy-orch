/** План агента, шаги хода, длительность хода и последний ответ оператору — на поддельном шлюзе. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, PlanEntry } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { AppError } from '../../../src/domain/errors'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

interface Ctx {
	orch: Orchestrator
	gw: FakeGateway
	hub: HubEvent[]
	clock: { t: number; now(): number }
}

function setup(): Ctx {
	const clock = {
		t: 1_000_000,
		now(): number {
			return this.t
		},
	}
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs: 3000 },
		store: new MemoryStore(),
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
		clock,
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const hub: HubEvent[] = []
	orch.hub.subscribe(e => hub.push(e))
	return { orch, gw, hub, clock }
}

/** Создать агента и дождаться начала хода n-го промпта. */
async function turnStarted(ctx: Ctx, n: number): Promise<void> {
	await until(() => ctx.gw.prompts.length >= n, 2000, `промпт ${n}`)
	await new Promise(r => setTimeout(r, 5)) // дать установиться promptId
}

async function spawn(ctx: Ctx, name = 'alpha', prompt = 'задача'): Promise<string> {
	const r = await ctx.orch.spawn({ space: 'main', name, prompt })
	await turnStarted(ctx, ctx.gw.prompts.length + 1)
	return r.agent.id
}

const done = (ctx: Ctx, n: number, text = 'готово'): void =>
	ctx.gw.emit({ kind: 'text', text, messageId: `m${n}` }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: `p-${n}` })

const entries = (...statuses: PlanEntry['status'][]): PlanEntry[] => statuses.map((status, i) => ({ content: `шаг ${i + 1}`, status }))
const tool = (toolId: string, status: 'in_progress' | 'completed' = 'in_progress') =>
	({ kind: 'tool', toolId, name: 'grep', title: `Grep ${toolId}`, input: {}, status, output: '' }) as const

describe('план агента', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('setPlan от самого агента: план в AgentView и в событии agent шины', async () => {
		const id = await spawn(ctx)
		const v = ctx.orch.setPlan(id, { from: id, entries: [{ content: ' a ', status: 'completed' }, { content: 'b', status: 'in_progress' }] })
		assert.deepEqual(v.plan?.entries, [
			{ content: 'a', status: 'completed' },
			{ content: 'b', status: 'in_progress' },
		])
		assert.equal(v.plan.source, 'cli')
		assert.equal(v.plan.updatedAt, new Date(ctx.clock.t).toISOString())
		const last = ctx.hub.filter(e => e.t === 'agent').at(-1)
		assert.deepEqual(last?.t === 'agent' ? last.agent.plan : null, v.plan)
		// без from — оператор может задать план; null — убрать
		assert.equal(ctx.orch.setPlan(id, { entries: entries('pending') }).plan?.entries.length, 1)
		assert.equal(ctx.orch.setPlan(id, { from: id, entries: null }).plan, null)
	})

	it('вводная учит публиковать план своим id', async () => {
		const id = await spawn(ctx)
		assert.match(ctx.orch.preambleFor(ctx.orch.resolveAgent(id)), new RegExp(`nessy-orch plan --from ${id} "- \\[x\\]`))
	})

	it('чужой from → 403 forbidden; неверные записи → 400 bad_plan; неизвестный агент → 404', async () => {
		const id = await spawn(ctx)
		const other = (await ctx.orch.spawn({ space: 'main', name: 'beta' })).agent.id
		assert.throws(() => ctx.orch.setPlan(id, { from: other, entries: entries('pending') }), (e: unknown) => e instanceof AppError && e.status === 403 && e.code === 'forbidden')
		assert.throws(() => ctx.orch.setPlan(id, { from: 'you', entries: entries('pending') }), (e: unknown) => e instanceof AppError && e.status === 403)
		assert.throws(() => ctx.orch.setPlan(id, { from: id, entries: [] }), (e: unknown) => e instanceof AppError && e.status === 400)
		assert.throws(() => ctx.orch.setPlan('nope', { entries: entries('pending') }), (e: unknown) => e instanceof AppError && e.status === 404)
		assert.equal(ctx.orch.getAgent(id).plan, null)
	})

	it('ACP plan в ходе → план с source acp (мягкая нормализация); вне хода — игнор', async () => {
		const id = await spawn(ctx)
		ctx.gw.emit({ kind: 'plan', entries: [{ content: 'Прочитать', status: 'completed' }, { content: ' ', status: 'pending' }, { content: 'Исправить', status: 'in_progress' }] })
		const p = ctx.orch.getAgent(id).plan
		assert.equal(p?.source, 'acp')
		assert.deepEqual(p.entries.map(e => e.content), ['Прочитать', 'Исправить'])
		done(ctx, 1)
		ctx.gw.emit({ kind: 'plan', entries: entries('pending') })
		assert.deepEqual(ctx.orch.getAgent(id).plan?.entries.map(e => e.content), ['Прочитать', 'Исправить'], 'реплей вне хода не меняет план')
		ctx.gw.emit({ kind: 'plan', entries: [] })
		assert.notEqual(ctx.orch.getAgent(id).plan, null)
	})

	it('сброс: новая задача от you после выполненного плана — план null', async () => {
		const id = await spawn(ctx)
		ctx.orch.setPlan(id, { from: id, entries: entries('completed', 'completed') })
		done(ctx, 1)
		await ctx.orch.send(id, { text: 'новая задача' })
		await turnStarted(ctx, 2)
		assert.equal(ctx.orch.getAgent(id).plan, null)
	})

	it('уточнение при недоделанном плане — план сохраняется', async () => {
		const id = await spawn(ctx)
		ctx.orch.setPlan(id, { from: id, entries: entries('completed', 'in_progress') })
		await ctx.orch.send(id, { text: 'уточнение' }) // прерывает ход
		ctx.gw.emit({ kind: 'cancelled', promptId: 'p-1' })
		await turnStarted(ctx, 2)
		assert.equal(ctx.orch.getAgent(id).plan?.entries.length, 2)
	})

	it('план выполнен, но в очереди есть работа или сообщение от агента — план сохраняется', async () => {
		const id = await spawn(ctx)
		const beta = (await ctx.orch.spawn({ space: 'main', name: 'beta' })).agent.id
		ctx.orch.setPlan(id, { from: id, entries: entries('completed') })
		await ctx.orch.send(id, { from: beta, text: 'от агента' })
		await ctx.orch.send(id, { text: 'от you в очередь', interrupt: false })
		done(ctx, 1)
		await turnStarted(ctx, 2) // ход по сообщению агента: план на месте
		assert.notEqual(ctx.orch.getAgent(id).plan, null)
		done(ctx, 2)
		await turnStarted(ctx, 3) // сообщение you, очередь пуста, план выполнен — сброс
		assert.equal(ctx.orch.getAgent(id).plan, null)
	})
})

describe('шаги, длительность и последний ответ', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('turnSteps — различные toolId текущего хода; после хода сохраняется, новый ход — с нуля', async () => {
		const id = await spawn(ctx)
		assert.equal(ctx.orch.getAgent(id).turnSteps, 0)
		ctx.gw.emit(tool('t1'), tool('t1', 'completed'), tool('t2'), tool('t3'), tool('t2', 'completed'))
		assert.equal(ctx.orch.getAgent(id).turnSteps, 3)
		done(ctx, 1)
		assert.equal(ctx.orch.getAgent(id).turnSteps, 3, 'после хода показывает последний ход')
		await ctx.orch.send(id, { text: 'ещё' })
		await turnStarted(ctx, 2)
		assert.equal(ctx.orch.getAgent(id).turnSteps, 0)
		ctx.gw.emit(tool('t1'))
		assert.equal(ctx.orch.getAgent(id).turnSteps, 1, 'тот же toolId в новом ходе — новый шаг')
	})

	it('lastTurnMs — длительность последнего завершённого хода', async () => {
		const id = await spawn(ctx)
		assert.equal(ctx.orch.getAgent(id).lastTurnMs, null)
		ctx.clock.t += 4321
		done(ctx, 1)
		assert.equal(ctx.orch.getAgent(id).lastTurnMs, 4321)
	})

	it('lastReply — ответ оператору: msgId, ts, превью простым текстом ≤ 200', async () => {
		const id = await spawn(ctx)
		done(ctx, 1, '## Итог\n\n**Готово**: ' + 'x'.repeat(300))
		const reply = ctx.orch.listMessages({ limit: 100 }).find(m => m.kind === 'reply')
		const lr = ctx.orch.getAgent(id).lastReply
		assert.equal(lr?.msgId, reply?.id)
		assert.equal(lr?.ts, reply?.ts)
		assert.equal(lr?.failed, undefined)
		assert.ok(lr?.preview.startsWith('Итог Готово: xxx'))
		assert.equal(lr?.preview.length, 200)
		const last = ctx.hub.filter(e => e.t === 'agent').at(-1)
		assert.equal(last?.t === 'agent' ? last.agent.lastReply?.msgId : null, reply?.id, 'опубликован в шине')
	})

	it('lastReply с ошибкой хода — failed', async () => {
		const id = await spawn(ctx)
		ctx.gw.emit({ kind: 'turn_error', message: 'Rate limit', retryable: true, code: 429 }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		assert.equal(ctx.orch.getAgent(id).lastReply?.failed, 'Rate limit')
	})

	it('ответ другому агенту lastReply не меняет', async () => {
		const id = await spawn(ctx)
		done(ctx, 1, 'оператору')
		const first = ctx.orch.getAgent(id).lastReply
		const beta = (await ctx.orch.spawn({ space: 'main', name: 'beta' })).agent.id
		await ctx.orch.send(id, { from: beta, text: 'вопрос' })
		await turnStarted(ctx, 2)
		done(ctx, 2, 'агенту')
		assert.deepEqual(ctx.orch.getAgent(id).lastReply, first)
	})
})
