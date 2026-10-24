import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runAgentPortConformance } from '../../support/agent-port-conformance'
import { defaultRespond, makePort, waitFor } from './sdk-test-support'

describe('NessySdkAgentPort', () => {
	it('capabilities: streamText/setModel/permissionVote=true, midTurn=false', () => {
		assert.deepEqual(makePort(defaultRespond).port.capabilities, { streamText: true, midTurn: false, permissionVote: true, setModel: true })
	})

	it('sessionCreate возвращает sessionId и спавнит query; session.ready синтезируется на подписке', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const r = await port.sessionCreate('/ws')
		assert.ok(r.sessionId.length > 0)
		assert.ok(lastQuery(), 'query должен быть создан')
		const types: string[] = []
		port.subscribe(r.sessionId, { onEvent: e => types.push(e.type) })
		assert.ok(types.includes('session.ready'))
	})

	it('промпт: turn.started → message.delta → message.completed → turn.completed', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: string[] = []
		port.subscribe(id, { onEvent: e => events.push(e.type) })
		await port.promptSend(id, 'тест')
		await waitFor(events, 'turn.completed')
		const order = ['turn.started', 'message.delta', 'message.completed', 'turn.completed']
		for (const t of order) assert.ok(events.includes(t), `нет события ${t}: ${events.join(', ')}`)
	})

	it('interrupt (exit-130) → turn.cancelled', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: string[] = []
		port.subscribe(id, { onEvent: e => events.push(e.type) })
		await port.promptSend(id, '#slow')
		await waitFor(events, 'turn.started')
		await port.promptCancel(id)
		await waitFor(events, 'turn.cancelled')
	})

	it('ошибка хода → turn.failed', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: string[] = []
		port.subscribe(id, { onEvent: e => events.push(e.type) })
		await port.promptSend(id, '#error')
		await waitFor(events, 'turn.failed')
	})

	it('верификация модели: расхождение → model.switch_failed', async () => {
		const { port } = makePort(defaultRespond, 'expected/model')
		const id = (await port.sessionCreate()).sessionId
		const events: { type: string; data?: unknown }[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await waitFor(events, 'model.switch_failed')
		const ev = (events.find(e => e.type === 'model.switch_failed') as { type: string; data?: unknown }).data as { expected: string; actual: string }
		assert.equal(ev.expected, 'expected/model')
		assert.equal(ev.actual, 'm')
	})

	it('model.set успешный → model.switched', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: string[] = []
		port.subscribe(id, { onEvent: e => events.push(e.type) })
		await port.modelSet(id, 'other/model')
		assert.ok(events.includes('model.switched'))
		assert.ok(lastQuery().calls.includes('setModel:other/model'))
	})

	it('permission.vote: голос по неизвестному запросу отклоняется', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: { type: string; data?: unknown }[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await assert.rejects(() => port.permissionVote(id, 'nope', 'allow'))
		assert.ok(!events.some(e => e.type === 'permission.resolved'))
	})

	it('sessionClose → session.closed и query.close()', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: string[] = []
		port.subscribe(id, { onEvent: e => events.push(e.type) })
		await port.sessionClose(id)
		assert.ok(events.includes('session.closed'))
		assert.ok(lastQuery().calls.includes('close'))
	})

	it('midTurnSend отклоняется (midTurn=false)', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		await assert.rejects(() => port.midTurnSend(id, 'msg'))
	})

	it('первый промпт синтезирует session.meta (displayName) — как у serve-пути', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: { type: string; data?: unknown }[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await port.promptSend(id, 'первый промпт сессии')
		const meta = events.find(e => e.type === 'session.meta')
		assert.ok(meta, `нет session.meta: ${events.map(e => e.type).join(', ')}`)
		assert.equal((meta.data as { displayName?: string }).displayName, 'первый промпт сессии')
	})

	it('closeAll закрывает все живые сессии', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const a = (await port.sessionCreate()).sessionId
		const b = (await port.sessionCreate()).sessionId
		const qa = lastQuery()
		await port.closeAll()
		assert.ok(qa.calls.includes('close'), 'query первой сессии закрыт')
		await assert.rejects(() => port.promptSend(a, 'x'), /не найдена/)
		await assert.rejects(() => port.promptSend(b, 'x'), /не найдена/)
	})

	it('seq монотонен и уникален для всех событий', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const types: string[] = []
		const seqs: number[] = []
		port.subscribe(id, { onEvent: e => (types.push(e.type), seqs.push(e.seq)) })
		await port.promptSend(id, 'валидность')
		await waitFor(types, 'turn.completed')
		assert.ok(seqs.length >= 3)
		for (let i = 1; i < seqs.length; i++) assert.ok((seqs[i] as number) > (seqs[i - 1] as number), `seq не монотонен: ${seqs.join(', ')}`)
	})

	it('tool_use/tool_result → tool_call.started/completed (toolId/name/title, статус и output)', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: { type: string; data?: unknown }[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		await port.promptSend(id, '#tools')
		await waitFor(events, 'turn.completed')
		const start = events.find(e => e.type === 'tool_call.started')
		assert.ok(start, `нет tool_call.started: ${events.map(e => e.type).join(', ')}`)
		const startData = start.data as { toolId: string; name: string; title?: string; input: Record<string, unknown> }
		assert.equal(startData.toolId, 't1')
		assert.equal(startData.name, 'grep')
		assert.equal(startData.title, 'grep')
		assert.deepEqual(startData.input, { query: 'x' })
		const done = events.find(e => e.type === 'tool_call.completed')
		assert.ok(done, `нет tool_call.completed: ${events.map(e => e.type).join(', ')}`)
		const doneData = done.data as { toolId: string; name: string; status: string; output: string }
		assert.equal(doneData.toolId, 't1')
		assert.equal(doneData.name, 'grep')
		assert.equal(doneData.status, 'completed')
		assert.equal(doneData.output, 'найдено 0')
	})

	it('NESSY_ORCH_TOKEN не передаётся SDK-ребёнку (env затирается пустой строкой)', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		await port.sessionCreate('/ws')
		assert.ok(lastQuery(), 'query должен быть создан')
		const env = lastQuery().envOption()
		assert.ok(env, 'ожидали env в опциях query')
		assert.equal(env['NESSY_ORCH_TOKEN'], '')
	})
})

// conformance-сьют на адаптере с фейковым Query (без живого nessy): обязательные сценарии порта.
describe('NessySdkAgentPort conformance', () => {
	runAgentPortConformance({
		label: 'nessy-sdk (mock)',
		cwd: '/ws',
		makePort: () => Promise.resolve(makePort(defaultRespond).port),
		metaPrompt: 'имя сессии из первого промпта',
		// permissionPrompt не задан: permission-кейс conformance пропускается (путь vote проверен в unit-тестах)
		toolsPrompt: '#tools',
		waitMs: 1500,
	})
})
