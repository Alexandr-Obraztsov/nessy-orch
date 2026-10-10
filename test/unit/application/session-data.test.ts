/** Данные сессии: источники, счётчики агента, токены, статус ответа, напоминание о незакрытом плане. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { beforeEach, describe, it } from 'node:test'
import type { ToolEvent } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

interface Ctx {
	orch: Orchestrator
	gw: FakeGateway
	store: MemoryStore
}

function setup(): Ctx {
	const store = new MemoryStore()
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs: 3000 },
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	return { orch, gw, store }
}

/** Агент в сессии с идущим ходом; promptId = p-1. */
async function startTurn(ctx: Ctx, sessionId: string): Promise<string> {
	const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', session: sessionId, prompt: 'задача' })
	await until(() => ctx.gw.prompts.length > 0, 2000, 'промпт отправлен')
	await until(() => ctx.orch.resolveAgent('alpha').currentMessage !== null, 2000, 'ход начат')
	await new Promise(r => setTimeout(r, 5))
	return r.agent.id
}

const REPLY = [
	'**Итог** — причина найдена.',
	'',
	'**Источники**',
	'1. MR !12 — https://gitlab.example.com/team/shippy/-/merge_requests/12',
	'2. `shippy@a1b2c3d:src/retry.ts:42`',
	'',
	'Статус: DONE_WITH_CONCERNS — не гонял e2e',
].join('\n')

describe('источники сессии', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('собираются из итогового ответа и из вызовов инструментов, без дублей', async () => {
		const s = ctx.orch.createSession({ title: 'Разбор CI' })
		await startTurn(ctx, s.id)
		ctx.gw.emit({ kind: 'tool', toolId: 't1', name: 'web_fetch', title: 'Fetch', input: { url: 'https://docs.example.com/retry' }, status: 'completed', output: '' })
		ctx.gw.emit({ kind: 'tool', toolId: 't2', name: 'web_fetch', title: 'Fetch', input: { url: 'https://docs.example.com/retry/' }, status: 'completed', output: '' })
		ctx.gw.emit({ kind: 'text', text: REPLY, messageId: 'm' })
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })

		const list = ctx.orch.sessionSources(s.id)
		assert.deepEqual(
			list.map(x => [x.kind, x.origin, x.label]),
			[
				['url', 'tool', 'retry'],
				['url', 'reply', 'MR !12'],
				['text', 'reply', 'shippy@a1b2c3d:src/retry.ts:42'],
			],
		)
		assert.equal(list.filter(x => x.href?.includes('docs.example.com')).length, 1, 'ссылка с хвостовым слэшем — дубль')
		assert.equal(ctx.orch.getSession(s.id).sources, 3)
		assert.equal(ctx.store.loadSources(s.id).length, 3, 'источники сохранены')
		assert.equal(list[0]?.agentName, 'alpha')
	})

	it('агент вне сессии источников не копит', async () => {
		const r = await ctx.orch.spawn({ space: 'main', name: 'solo', prompt: 'задача' })
		await until(() => ctx.gw.prompts.length > 0, 2000, 'промпт')
		await until(() => ctx.orch.resolveAgent(r.agent.id).currentMessage !== null, 2000, 'ход')
		await new Promise(r => setTimeout(r, 5))
		ctx.gw.emit({ kind: 'text', text: REPLY, messageId: 'm' })
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		const s = ctx.orch.createSession({ title: 'Пустая' })
		assert.deepEqual(ctx.orch.sessionSources(s.id), [])
	})
})

describe('счётчики и ответ агента', () => {
	it('ходы, инструменты, время и статус из последней строки ответа', async () => {
		const ctx = setup()
		const s = ctx.orch.createSession({ title: 'Счётчики' })
		const id = await startTurn(ctx, s.id)
		ctx.gw.emit({ kind: 'tool', toolId: 't1', name: 'bash', title: 'ls', input: {}, status: 'completed', output: '' })
		ctx.gw.emit({ kind: 'tool', toolId: 't2', name: 'bash', title: 'pwd', input: {}, status: 'completed', output: '' })
		ctx.gw.emit({ kind: 'text', text: REPLY, messageId: 'm' })
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1', usage: { input: 1000, output: 250, cached: 400, total: 1250 } })
		const a = ctx.orch.getAgent(id)
		assert.equal(a.stats.turns, 1)
		assert.equal(a.stats.toolCalls, 2)
		assert.deepEqual(a.stats.tokens, { input: 1000, output: 250, cached: 400, total: 1250 })
		assert.equal(a.lastReply?.status, 'DONE_WITH_CONCERNS')
		assert.equal(a.lastReply.reason, 'не гонял e2e')
	})

	it('токены нарастающим итогом из /stats переопределяют сумму по ходам', async () => {
		const ctx = setup()
		ctx.gw.usageValue = { input: 5000, output: 900, cached: 0, total: 5900 }
		const s = ctx.orch.createSession({ title: 'Токены' })
		const id = await startTurn(ctx, s.id)
		ctx.gw.emit({ kind: 'text', text: 'ок', messageId: 'm' })
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1', usage: { input: 10, output: 5, cached: 0, total: 15 } })
		await until(() => ctx.orch.getAgent(id).stats.tokens?.total === 5900, 2000, 'токены из /stats')
	})

	it('nessy не сообщает токены — null, а не нули', async () => {
		const ctx = setup()
		const s = ctx.orch.createSession({ title: 'Без токенов' })
		const id = await startTurn(ctx, s.id)
		ctx.gw.emit({ kind: 'text', text: 'ок', messageId: 'm' })
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		assert.equal(ctx.orch.getAgent(id).stats.tokens, null)
	})
})

describe('тайминги инструментов и потерянный ход', () => {
	it('у завершённого вызова есть endedTs, у идущего — нет', async () => {
		const ctx = setup()
		const s = ctx.orch.createSession({ title: 'Тайминги' })
		const id = await startTurn(ctx, s.id)
		ctx.gw.emit({ kind: 'tool', toolId: 't1', name: 'bash', title: 'sleep', input: {}, status: 'in_progress', output: '' })
		const tools = (): ToolEvent[] => ctx.orch.agentHistory(id).filter((e): e is ToolEvent => e.kind === 'tool')
		const running = tools()[0]
		assert.ok(running && running.endedTs === undefined)
		ctx.gw.emit({ kind: 'tool', toolId: 't1', name: 'bash', title: 'sleep', input: {}, status: 'completed', output: 'ok' })
		const done = tools().at(-1)
		assert.ok(done && typeof done.endedTs === 'number' && done.endedTs >= done.ts)
	})

	it('ход «в полёте» при рестарте: ответ с ошибкой отправителю и пометка в чате', async () => {
		const ctx = setup()
		const s = ctx.orch.createSession({ title: 'Рестарт' })
		const id = await startTurn(ctx, s.id)
		ctx.store.flush()
		assert.ok(ctx.store.state.agents[0]?.inflight, 'ход сохранён как «в полёте»')

		const orch2 = new Orchestrator({
			settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs: 3000 },
			store: ctx.store,
			spaceFactory: init => new FakeSpace(init.name, init.path, ctx.gw),
		})
		orch2.load()
		orch2.start()
		const a = orch2.getAgent(id)
		assert.equal(a.status, 'error')
		assert.match(a.error ?? '', /перезапущен/)
		const reply = orch2.listMessages({ limit: 50 }).find(m => m.kind === 'reply' && m.from === id)
		assert.ok(reply?.failed, 'отправитель получил ответ с ошибкой')
		assert.ok(orch2.agentHistory(id).some(e => e.kind === 'system' && /перезапущен/.test(e.text)))
	})
})
