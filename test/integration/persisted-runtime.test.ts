/** Восстановление runtime пространства из состояния: tclaude-пространство остаётся tclaude после рестарта. */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import type { RuntimeId, SpaceView } from '../../shared/types'
import type { AgentPort } from '../../src/application/agent-port'
import type { SpaceFactory, SpaceInit, SpaceListener, SpaceRuntime } from '../../src/application/ports'
import { FakeAgentPort } from '../support/fake-agent-port'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 30000 }

/** Пространство, чей runtime берётся из init (как у реальных TclaudeSpace/NessySdkSpace), без процесса. */
class RuntimeAwareSpace implements SpaceRuntime {
	readonly url = null
	readonly color = 210
	readonly runtime: RuntimeId
	readonly model: string | null
	status: SpaceView['status'] = 'ready'
	readonly name: string
	readonly path: string
	readonly client: AgentPort = new FakeAgentPort()

	constructor(init: SpaceInit, _listener: SpaceListener) {
		this.name = init.name
		this.path = init.path
		this.runtime = init.runtime ?? 'nessy-sdk'
		this.model = init.model ?? null
	}

	ensureReady(): Promise<AgentPort> {
		return Promise.resolve(this.client)
	}
	stop(): Promise<void> {
		return Promise.resolve()
	}
	killSync(): void {
		/* без процесса */
	}
	toJSON(): SpaceView {
		return { name: this.name, path: this.path, color: this.color, mode: 'managed', url: null, status: this.status, error: null, runtime: this.runtime }
	}
}

const runtimeAwareFactory: SpaceFactory = (init, listener) => new RuntimeAwareSpace(init, listener)

describe('восстановление PersistedSpace.runtime', () => {
	let first: Harness | null = null
	let second: Harness | null = null
	after(async () => {
		await first?.close({ keepFiles: true })
		await second?.close()
	})

	it('runtime пространства переживает рестарт (tclaude остаётся tclaude)', T, async () => {
		first = await startHarness({ spaceFactory: runtimeAwareFactory })
		const created = await first.api<SpaceView>('POST', '/spaces', { path: first.ws, name: 'main', runtime: 'tclaude' })
		assert.equal(created.status, 201, JSON.stringify(created.body))
		assert.equal(created.body.runtime, 'tclaude')
		const base = first.base
		await first.close({ keepFiles: true })
		first = null

		second = await startHarness({ base, spaceFactory: runtimeAwareFactory })
		const g = await second.api<{ spaces: SpaceView[] }>('GET', '/graph')
		const space = g.body.spaces.find(s => s.name === 'main')
		assert.ok(space, 'пространство восстановлено из состояния')
		assert.equal(space.runtime, 'tclaude', 'runtime должен сохраниться в PersistedSpace и восстановиться')
	})
})
