/** Ответ агента человеку: главный агент получает короткую копию, а не весь текст. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

describe('копия ответа человеку для главного агента', () => {
	it('длинный ответ обрезается до 300 знаков с указанием show; полный остаётся человеку', async () => {
		const gw = new FakeGateway()
		const store = new MemoryStore()
		const orch = new Orchestrator({
			settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0 },
			store,
			spaceFactory: init => new FakeSpace(init.name, init.path, gw),
		})
		orch.addSpace({ path: os.tmpdir(), name: 'main' })
		const s = orch.createSession({ title: 'Копия' })
		await orch.spawn({ space: 'main', name: 'w', session: s.id })
		await orch.send('w', { text: 'вопрос', from: 'user' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт')
		gw.emit({ kind: 'text', text: 'я'.repeat(1000), messageId: 'm' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		await until(() => store.messages.some(m => m.kind === 'reply' && m.to === 'you' && m.from !== 'system'), 2000, 'ответ и копия')
		const [toUser, toLead] = [store.messages.find(m => m.kind === 'reply' && m.to === 'user'), store.messages.find(m => m.kind === 'reply' && m.to === 'you' && m.from !== 'system')]
		assert.equal(toUser?.text.length, 1000)
		assert.ok((toLead?.text.length ?? 0) < 450, 'копия короткая')
		assert.match(toLead?.text ?? '', /\(полностью: nessy-orch show w\)$/)
	})
})
