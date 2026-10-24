import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { TclaudeSpace } from '../../../../src/infrastructure/process/tclaude-space'
import { TclaudeAgentPort } from '../../../../src/infrastructure/tclaude/agent-port-tclaude'
import type { SpaceListener } from '../../../../src/application/ports'

const noopListener: SpaceListener = { onStatus: () => undefined, onExit: () => undefined }

describe('TclaudeSpace', () => {
	it('статичные поля: runtime tclaude, url null, status ready, name/path', () => {
		const space = new TclaudeSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		assert.equal(space.runtime, 'tclaude')
		assert.equal(space.url, null)
		assert.equal(space.status, 'ready')
		assert.equal(space.name, 'ws')
		assert.equal(space.path, '/ws')
	})

	it('модель: init.model приоритетнее opts.model; иначе opts.model; иначе null', () => {
		assert.equal(new TclaudeSpace({ name: 'a', path: '/a', model: 'opus' }, { model: 'sonnet' }, noopListener).model, 'opus')
		assert.equal(new TclaudeSpace({ name: 'b', path: '/b' }, { model: 'sonnet' }, noopListener).model, 'sonnet')
		assert.equal(new TclaudeSpace({ name: 'c', path: '/c' }, {}, noopListener).model, null)
	})

	it('color: из init, иначе 210', () => {
		assert.equal(new TclaudeSpace({ name: 'a', path: '/a', color: 120 }, {}, noopListener).color, 120)
		assert.equal(new TclaudeSpace({ name: 'b', path: '/b' }, {}, noopListener).color, 210)
	})

	it('ensureReady: создаёт и кэширует один TclaudeAgentPort', async () => {
		const space = new TclaudeSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		const p1 = await space.ensureReady()
		const p2 = await space.ensureReady()
		assert.ok(p1 instanceof TclaudeAgentPort)
		assert.equal(p1, p2)
	})

	it('stop() закрывает сессии порта (closeAll) и сбрасывает client', async () => {
		const space = new TclaudeSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		const port = (await space.ensureReady()) as unknown as TclaudeAgentPort
		const closeAll = mock.method(port, 'closeAll', () => Promise.resolve())
		await space.stop()
		assert.equal(closeAll.mock.callCount(), 1)
		// после stop новый ensureReady даёт новый порт
		const port2 = await space.ensureReady()
		assert.notEqual(port2, port)
	})

	it('killSync() сбрасывает client и закрывает сессии в фоне', async () => {
		const space = new TclaudeSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		const port = (await space.ensureReady()) as unknown as TclaudeAgentPort
		const closeAll = mock.method(port, 'closeAll', () => Promise.resolve())
		space.killSync()
		assert.equal(closeAll.mock.callCount(), 1)
		const port2 = await space.ensureReady()
		assert.notEqual(port2, port)
	})

	it('stop/killSync без созданного порта — no-op', async () => {
		const space = new TclaudeSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		await space.stop()
		space.killSync()
	})

	it('toJSON возвращает SpaceView с runtime tclaude', () => {
		const space = new TclaudeSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		assert.deepEqual(space.toJSON(), {
			name: 'ws',
			path: '/ws',
			color: 210,
			mode: 'managed',
			url: null,
			status: 'ready',
			error: null,
			runtime: 'tclaude',
		})
	})
})
