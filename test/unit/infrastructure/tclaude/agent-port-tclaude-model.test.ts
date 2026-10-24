/** tclaude: модель сессии (sessionCreate) и подтверждение фактической модели из system/init. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { firstChild, makePort } from './tclaude-test-support'

describe('TclaudeAgentPort: модель сессии', () => {
	it('opts.model перебивает модель порта в аргументах спавна', async () => {
		const { port, calls } = makePort('opus')
		await port.sessionCreate('/ws', { model: 'haiku' })
		assert.equal(calls[0]?.model, 'haiku')
		const bare = makePort('opus')
		await bare.port.sessionCreate('/ws')
		assert.equal(bare.calls[0]?.model, 'opus')
	})

	it('system/init → session.meta с фактической моделью; расхождение даёт ещё и model.switch_failed', async () => {
		const { port, children } = makePort()
		const { sessionId } = await port.sessionCreate('/ws', { model: 'sonnet' })
		const events: { type: string; data: unknown }[] = []
		port.subscribe(sessionId, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		firstChild(children).emitLine({ type: 'system', subtype: 'init', model: 'zai/glm-4.6' })
		const meta = events.find(e => e.type === 'session.meta')?.data as { data?: { model?: string } } | undefined
		assert.equal(meta?.data?.model, 'zai/glm-4.6')
		assert.ok(events.some(e => e.type === 'model.switch_failed'))
	})

	it('подтверждение совпавшей модели без switch_failed; поздняя подписка получает подтверждение', async () => {
		const { port, children } = makePort()
		const { sessionId } = await port.sessionCreate('/ws', { model: 'sonnet' })
		firstChild(children).emitLine({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-5' })
		const events: { type: string; data: unknown }[] = []
		port.subscribe(sessionId, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		const meta = events.find(e => e.type === 'session.meta')?.data as { data?: { model?: string } } | undefined
		assert.equal(meta?.data?.model, 'claude-sonnet-4-5')
		assert.ok(!events.some(e => e.type === 'model.switch_failed'))
	})
})
