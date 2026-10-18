/** Не держим много сессий: сверх лимита давние простаивающие удаляются вместе с агентами; свежие и работающие остаются. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FileLearningStore } from '../../../src/infrastructure/persistence/learning-store'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'

function setup(maxSessions: number) {
	const clock = { t: Date.now() }
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0, maxSessions },
		store: new MemoryStore(),
		clock: { now: () => clock.t },
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	return { orch, clock }
}

describe('уборка сессий', () => {
	it('сверх лимита удаляется самая давняя простаивающая вместе с агентами; свежая не удаляется', async () => {
		const { orch, clock } = setup(2)
		const a = orch.createSession({ title: 'Старая' })
		await orch.spawn({ space: 'main', name: 'old-agent', session: a.id })
		clock.t += 3_600_000
		const b = orch.createSession({ title: 'Средняя' })
		clock.t += 3_600_000
		const c = orch.createSession({ title: 'Новая' })
		await orch.pruneSessions(c.id)
		assert.deepEqual(orch.listSessions().map(s => s.id).sort(), [b.id, c.id].sort(), 'старая удалена')
		assert.ok(!orch.listAgents().some(x => x.name === 'old-agent'), 'её простаивающий агент тоже')
	})

	it('сессия, где что-то происходило недавно или работает агент, остаётся (лимит временно превышен)', async () => {
		const { orch, clock } = setup(1)
		const a = orch.createSession({ title: 'Работает' })
		const agent = (await orch.spawn({ space: 'main', name: 'busy', session: a.id })).agent.id
		orch.resolveAgent(agent).queue.push({ seq: 0, id: 'm', ts: 0, from: 'you', to: agent, kind: 'msg', text: 'ждёт', hops: 0 })
		clock.t += 3_600_000
		const b = orch.createSession({ title: 'Другая' })
		await orch.pruneSessions(b.id)
		assert.equal(orch.listSessions().length, 2)
	})

	it('сессия с незакрытым кейсом обучения не удаляется, после ready удаляется', async () => {
		const clock = { t: Date.now() }
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-learn-'))
		const orch = new Orchestrator({
			settings: { home, autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0, maxSessions: 1, learningTickMs: 0 },
			store: new MemoryStore(),
			clock: { now: () => clock.t },
			spaceFactory: init => new FakeSpace(init.name, init.path, new FakeGateway()),
			learningStore: new FileLearningStore(home, path.resolve(__dirname, '..', '..', '..', '..')),
		})
		const learning = orch.learning
		assert.ok(learning)
		const protectedIds = new Set<string>()
		learning.isProtected = id => protectedIds.has(id)
		const a = orch.createSession({ title: 'Старая' })
		protectedIds.add(a.id)
		clock.t += 3_600_000
		const b = orch.createSession({ title: 'Новая' })
		await orch.pruneSessions(b.id)
		assert.ok(orch.listSessions().some(x => x.id === a.id), 'кейс не ready — сессия остаётся')
		protectedIds.clear()
		await orch.pruneSessions(b.id)
		assert.deepEqual(orch.listSessions().map(x => x.id), [b.id], 'кейс ready — сессия удалена')
		fs.rmSync(home, { recursive: true, force: true })
	})
})
