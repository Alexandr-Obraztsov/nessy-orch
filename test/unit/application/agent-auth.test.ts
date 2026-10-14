/** Вводная и напоминания агента содержат его ключ только при включённой проверке токенов. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

async function firstPrompt(authRequired: boolean): Promise<{ prompt: string; key: string }> {
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0, authRequired },
		store: new MemoryStore(),
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const r = await orch.spawn({ space: 'main', name: 'alpha', prompt: 'задача' })
	await until(() => gw.prompts.length === 1, 2000, 'промпт')
	return { prompt: gw.prompts[0] ?? '', key: orch.resolveAgent(r.agent.id).key }
}

describe('ключ агента в вводной', () => {
	it('проверка включена: --from <id> --key <ключ> в send, plan и напоминании', async () => {
		const { prompt, key } = await firstPrompt(true)
		assert.ok(key.length >= 20)
		assert.match(prompt, new RegExp(`send --from \\S+ --key ${key}`))
		assert.match(prompt, new RegExp(`plan --from \\S+ --key ${key}`))
		assert.equal(prompt.split(key).length - 1 >= 3, true)
	})

	it('проверка выключена: ключа в тексте нет', async () => {
		const { prompt, key } = await firstPrompt(false)
		assert.ok(!prompt.includes(key))
		assert.ok(!prompt.includes('--key'))
	})
})
