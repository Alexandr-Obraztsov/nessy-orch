/** tclaude: многоходовость, потеря текста (stream_event), изоляция процессов, утечка HOME. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { describe, it } from 'node:test'
import { firstChild, makePort, subscribedSession } from './tclaude-test-support'
import { KILL_GRACE_MS } from '../../../../src/infrastructure/tclaude/tclaude-session'

describe('TclaudeAgentPort (многоходовость и диагностика)', () => {
	it('stream_event (text_delta) → message.delta и message.completed с текстом (потеря текста)', async () => {
		const { port, children } = makePort()
		const { sessionId } = await subscribedSession(port)
		const child = firstChild(children)
		const completed: string[] = []
		port.subscribe(sessionId, {
			onEvent: e => {
				if (e.type === 'message.completed') completed.push((e.data as { text: string }).text)
			},
		})
		await port.promptSend(sessionId, 'x')
		child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'при' } } })
		child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'вет' } } })
		child.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		assert.deepEqual(completed, ['привет'], 'текст из дельт должен дойти до message.completed')
	})

	it('promptSend на мёртвом процессе → переподнятие с --resume и новый ход (многоходовость)', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		const first = firstChild(children)
		await port.promptSend(sessionId, 'ход 1')
		first.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		first.emitExit(0) // -p-процесс завершается после result
		const before = children.length
		await port.promptSend(sessionId, 'ход 2')
		assert.equal(children.length, before + 1, 'должен переподняться новый процесс')
		const newChild = children[children.length - 1]
		assert.ok(newChild, 'ожидали новый процесс')
		assert.ok(first.killed, 'старый процесс должен быть остановлен')
		newChild.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'второй' } } })
		assert.ok(types.includes('message.delta'), 'ход нового процесса обрабатывается')
	})

	it('события старого процесса после modelSet игнорируются (не текут в новый ход)', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		const old = firstChild(children)
		await port.modelSet(sessionId, 'opus') // рестарт → новый процесс
		assert.equal(children.length, 2)
		const before = types.length
		old.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'старое' } } })
		assert.equal(types.length, before, 'события старого процесса не должны обрабатываться')
		const fresh = children[1]
		assert.ok(fresh, 'ожидали новый процесс')
		fresh.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'новое' } } })
		assert.ok(types.includes('message.delta'), 'события нового процесса обрабатываются')
	})

	it('sessionClose удаляет временный HOME агента (нет утечки)', async () => {
		const { port, calls } = makePort()
		const { sessionId } = await port.sessionCreate('/ws')
		const home = calls[0]?.homeDir
		assert.ok(home, 'ожидали homeDir')
		assert.equal(fs.existsSync(home), true)
		await port.sessionClose(sessionId)
		assert.equal(fs.existsSync(home), false, 'temp HOME должен быть удалён после закрытия')
	})

	it('много-assistant-ход: ни один блок текста не теряется', async () => {
		const { port, children } = makePort()
		const { sessionId } = await subscribedSession(port)
		const completed: string[] = []
		port.subscribe(sessionId, { onEvent: e => (e.type === 'message.completed' ? completed.push((e.data as { text: string }).text) : undefined) })
		const child = firstChild(children)
		await port.promptSend(sessionId, 'x')
		child.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'часть' }] } })
		child.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: ' два' }] } })
		child.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		assert.deepEqual(completed, ['часть два'], 'оба assistant-блока должны дойти до message.completed')
	})

	it('delta+assistant-финал: текст не дублируется и не теряется', async () => {
		const { port, children } = makePort()
		const { sessionId } = await subscribedSession(port)
		const completed: string[] = []
		port.subscribe(sessionId, { onEvent: e => (e.type === 'message.completed' ? completed.push((e.data as { text: string }).text) : undefined) })
		const child = firstChild(children)
		await port.promptSend(sessionId, 'x')
		child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'при' } } })
		child.emitLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'вет' } } })
		child.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'привет' }] } })
		child.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		assert.deepEqual(completed, ['привет'], 'полный текст без дублирования')
	})

	it('respawn: зависший старый процесс добивается SIGKILL после grace (эскалация)', async () => {
		const { port, children } = makePort()
		const { sessionId } = await subscribedSession(port)
		const old = firstChild(children)
		await port.sessionResume(sessionId, '/ws') // respawn → SIGTERM старому
		assert.ok(old.signalLog.includes('SIGTERM'), 'SIGTERM должен быть послан при респавне')
		await new Promise(r => setTimeout(r, KILL_GRACE_MS + 200))
		assert.ok(old.signalLog.includes('SIGKILL'), 'не завершившийся за grace процесс должен быть добит SIGKILL')
	})
})
