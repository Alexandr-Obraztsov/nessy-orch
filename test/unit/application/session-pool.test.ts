/** Пул заранее созданных сессий nessy: быстрый запуск агента, пополнение, срок годности, сброс при падении serve. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

function setup(warmSessions: number, gwInit?: (gw: FakeGateway) => void) {
	const store = new MemoryStore()
	const gw = new FakeGateway()
	gwInit?.(gw)
	let now = 1_000_000
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs: 3000, warmSessions },
		store,
		clock: { now: () => now },
		spaceFactory: (init, listener) => new FakeSpace(init.name, init.path, gw, listener),
	})
	return { orch, gw, store, tick: (ms: number) => (now += ms) }
}

describe('пул заготовок сессий', () => {
	it('при добавлении пространства сессии создаются про запас, spawn берёт готовую и пул пополняется', async () => {
		const { orch, gw } = setup(2)
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		await until(() => gw.created === 2, 2000, 'две заготовки')
		const r = await orch.spawn({ space: 'main', name: 'alpha', prompt: 'задача' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт ушёл')
		assert.equal(orch.resolveAgent(r.agent.id).nessyId, 's-1', 'агент взял заготовку, а не создавал сессию')
		await until(() => gw.created === 3, 2000, 'пул пополнен до двух')
	})

	it('без пула (0) сессия создаётся при запуске агента', async () => {
		const { orch, gw } = setup(0)
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		await new Promise(r => setTimeout(r, 30))
		assert.equal(gw.created, 0, 'про запас ничего не создаётся')
		await orch.spawn({ space: 'main', name: 'alpha', prompt: 'задача' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт ушёл')
		assert.equal(gw.created, 1)
	})

	it('быстрее: с долгим созданием сессии агент стартует мгновенно, если заготовка готова', async () => {
		const { orch, gw } = setup(1, g => (g.sessionDelayMs = 300))
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		await until(() => gw.created === 1, 3000, 'заготовка запрошена')
		await new Promise(r => setTimeout(r, 350)) // дождаться завершения создания
		const t0 = Date.now()
		await orch.spawn({ space: 'main', name: 'fast', prompt: 'задача' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт ушёл')
		assert.ok(Date.now() - t0 < 200, `с заготовкой промпт уходит без ожидания создания сессии (${Date.now() - t0} мс)`)
	})

	it('заготовка старше срока годности не используется', async () => {
		const { orch, gw, tick } = setup(1)
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		await until(() => gw.created === 1, 2000, 'заготовка')
		tick(11 * 60 * 1000)
		const r = await orch.spawn({ space: 'main', name: 'late', prompt: 'задача' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт ушёл')
		assert.notEqual(orch.resolveAgent(r.agent.id).nessyId, 's-1', 'залежавшаяся сессия отброшена')
		assert.ok(gw.closed.includes('s-1'), 'и закрыта')
	})

	it('падение serve сбрасывает пул', async () => {
		const { orch, gw } = setup(2)
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		await until(() => gw.created === 2, 2000, 'заготовки')
		const space = orch.registry.spaces.get('main') as FakeSpace
		space.crash()
		const r = await orch.spawn({ space: 'main', name: 'after', prompt: 'задача' })
		await until(() => gw.prompts.length === 1, 3000, 'промпт ушёл')
		const id = orch.resolveAgent(r.agent.id).nessyId
		assert.ok(id !== 's-1' && id !== 's-2', 'старые заготовки (жили в упавшем serve) не использованы')
	})
})
