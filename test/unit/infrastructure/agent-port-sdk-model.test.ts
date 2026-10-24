/** nessy-sdk: модель сессии (sessionCreate), подтверждение фактической модели из system/init, смена после резюма. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultRespond, makePort, waitFor } from './sdk-test-support'

interface Ev {
	type: string
	data?: unknown
}

const metaModel = (events: Ev[]): string[] =>
	events.flatMap(e => {
		const d = e.data as { displayName?: string; data?: { model?: string } } | undefined
		return e.type === 'session.meta' && d?.displayName === undefined && d?.data?.model ? [d.data.model] : []
	})

describe('NessySdkAgentPort: модель сессии', () => {
	it('opts.model перебивает модель порта; сверка с system/init идёт по модели сессии', async () => {
		const { port, lastQuery } = makePort(defaultRespond, 'port-model')
		const id = (await port.sessionCreate('/ws', { model: 'session-model' })).sessionId
		assert.equal(lastQuery().modelOption(), 'session-model')
		const events: Ev[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await waitFor(events, 'model.switch_failed')
		const failed = events.find(e => e.type === 'model.switch_failed')?.data as { expected: string; actual: string }
		assert.equal(failed.expected, 'session-model')
		assert.equal(failed.actual, 'm', 'фейковый init сообщает модель m')
	})

	it('без opts.model — модель порта; без обеих опция model не передаётся', async () => {
		const withDefault = makePort(defaultRespond, 'port-model')
		await withDefault.port.sessionCreate('/ws')
		assert.equal(withDefault.lastQuery().modelOption(), 'port-model')
		const bare = makePort(defaultRespond)
		await bare.port.sessionCreate('/ws', { model: null })
		assert.equal(bare.lastQuery().modelOption(), undefined)
	})

	it('system/init → session.meta с фактической моделью (подтверждение для ядра)', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate('/ws')).sessionId
		const events: Ev[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await waitFor(events, 'session.meta')
		assert.deepEqual(metaModel(events), ['m'])
	})

	it('modelSet у резюмированной сессии без процесса: модель применяется при запуске под первый ход', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const id = (await port.sessionCreate('/ws', { model: 'old' })).sessionId
		await port.sessionClose(id)
		assert.ok(await port.sessionResume(id, '/ws'), 'закрытая сессия поднимается')
		const events: Ev[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await port.modelSet(id, 'new')
		assert.ok(events.some(e => e.type === 'model.switched'))
		await port.promptSend(id, 'привет')
		assert.equal(lastQuery().modelOption(), 'new')
	})
})
