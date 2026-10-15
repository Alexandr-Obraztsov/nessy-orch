/** Служебные имена агентов назначает оркестратор (без коллизий у вызывающего); заголовок — отдельно от цели. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import { cleanTitle } from '../../../src/domain/naming'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'

describe('имена и заголовки агентов', () => {
	it('имя подбирается само: роль, роль-2, роль-3; без роли — agent, agent-2; повторные запуски не конфликтуют', async () => {
		const gw = new FakeGateway()
		const orch = new Orchestrator({
			settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0 },
			store: new MemoryStore(),
			spaceFactory: init => new FakeSpace(init.name, init.path, gw),
		})
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		orch.createRole({ name: 'Ревьюер', instructions: 'x', id: 'reviewer' })
		const names: string[] = []
		for (const role of ['reviewer', 'reviewer', undefined, undefined, 'reviewer']) names.push((await orch.spawn({ space: 'main', ...(role ? { role } : {}) })).agent.name)
		assert.deepEqual(names, ['reviewer', 'reviewer-2', 'agent', 'agent-2', 'reviewer-3'])
		const r = await orch.spawn({ space: 'main', title: '  Проверка   MR !512 \n', role: 'reviewer' })
		assert.equal(r.agent.title, 'Проверка MR !512')
		assert.equal(orch.getAgent(r.agent.id).title, 'Проверка MR !512')
		assert.equal((await orch.spawn({ space: 'main' })).agent.title, null)
	})

	it('cleanTitle: пробелы схлопнуты, длинное обрезается, пустое — null', () => {
		assert.equal(cleanTitle('  а   б '), 'а б')
		assert.equal(cleanTitle(''), null)
		assert.equal(cleanTitle(undefined), null)
		assert.equal(cleanTitle('я'.repeat(100))?.length, 80)
	})
})
