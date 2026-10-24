import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { NessySdkSpace } from '../../../../src/infrastructure/process/sdk-space'
import { NessySdkAgentPort } from '../../../../src/infrastructure/nessy/agent-port-sdk'
import type { SpaceListener } from '../../../../src/application/ports'

const noopListener: SpaceListener = { onStatus: () => undefined, onExit: () => undefined }

describe('NessySdkSpace', () => {
	it('статичные поля: runtime nessy-sdk, url null, status ready, name/path', () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		assert.equal(space.runtime, 'nessy-sdk')
		assert.equal(space.url, null)
		assert.equal(space.status, 'ready')
		assert.equal(space.name, 'ws')
		assert.equal(space.path, '/ws')
	})

	it('модель: init.model приоритетнее opts.model; иначе opts.model; иначе null', () => {
		assert.equal(new NessySdkSpace({ name: 'a', path: '/a', model: 'glm' }, { model: 'deepseek' }, noopListener).model, 'glm')
		assert.equal(new NessySdkSpace({ name: 'b', path: '/b' }, { model: 'deepseek' }, noopListener).model, 'deepseek')
		assert.equal(new NessySdkSpace({ name: 'c', path: '/c' }, {}, noopListener).model, null)
	})

	it('color: из init, иначе 210', () => {
		assert.equal(new NessySdkSpace({ name: 'a', path: '/a', color: 120 }, {}, noopListener).color, 120)
		assert.equal(new NessySdkSpace({ name: 'b', path: '/b' }, {}, noopListener).color, 210)
	})

	it('ensureReady: создаёт и кэширует один NessySdkAgentPort; permissionMode пробрасывается', async () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws' }, { permissionMode: 'auto' }, noopListener)
		const p1 = await space.ensureReady()
		const p2 = await space.ensureReady()
		assert.ok(p1 instanceof NessySdkAgentPort)
		assert.equal(p1, p2)
		assert.equal(space.client, p1)
	})

	it('ensureReady c моделью — модель в порту', async () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws', model: 'glm' }, {}, noopListener)
		const port = (await space.ensureReady()) as unknown as { expectedModel?: string }
		assert.equal(port.expectedModel, 'glm')
	})

	it('stop() закрывает сессии порта (closeAll) и сбрасывает client', async () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		const port = (await space.ensureReady()) as unknown as NessySdkAgentPort
		const closeAll = mock.method(port, 'closeAll', () => Promise.resolve())
		await space.stop()
		assert.equal(closeAll.mock.callCount(), 1)
		assert.equal(space.client, null)
		const port2 = await space.ensureReady()
		assert.notEqual(port2, port)
	})

	it('killSync() сбрасывает client и закрывает сессии в фоне', async () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		const port = (await space.ensureReady()) as unknown as NessySdkAgentPort
		const closeAll = mock.method(port, 'closeAll', () => Promise.resolve())
		space.killSync()
		assert.equal(closeAll.mock.callCount(), 1)
		assert.equal(space.client, null)
		const port2 = await space.ensureReady()
		assert.notEqual(port2, port)
	})

	it('stop/killSync без созданного порта — no-op', async () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		await space.stop()
		space.killSync()
		assert.equal(space.client, null)
	})

	it('toJSON возвращает SpaceView с runtime nessy-sdk', () => {
		const space = new NessySdkSpace({ name: 'ws', path: '/ws' }, {}, noopListener)
		assert.deepEqual(space.toJSON(), {
			name: 'ws',
			path: '/ws',
			color: 210,
			mode: 'managed',
			url: null,
			status: 'ready',
			error: null,
			runtime: 'nessy-sdk',
		})
	})
})
