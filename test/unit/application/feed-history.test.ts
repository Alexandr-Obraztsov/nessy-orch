/** История узла за пределами окна памяти (5000 сообщений) и уборка источников удалённой сессии. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import type { Message, SourceView } from '../../../shared/types'
import { Feed } from '../../../src/application/feed'
import { Hub } from '../../../src/application/hub'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'

const msg = (seq: number, from: string, to: string): Message => ({ seq, id: `m-${seq}`, ts: seq, from, to, kind: 'msg', text: `t${seq}`, hops: 0 })

describe('лента: история за окном памяти', () => {
	it('сообщения узла старше окна в 5000 дочитываются с диска', () => {
		const store = new MemoryStore()
		store.messages = [msg(1, 'you', 'old'), msg(2, 'old', 'you')]
		for (let i = 3; i < 5400; i++) store.messages.push(msg(i, 'you', 'busy'))
		const feed = new Feed({
			hub: new Hub(),
			store,
			clock: { now: () => 0 },
			ids: { next: () => 'x' },
			onChange: () => undefined,
			sessionOf: () => null,
			activeAgents: () => 0,
		})
		feed.load(5400, 0)
		assert.deepEqual(feed.list({ involving: 'old' }).map(m => m.seq), [1, 2], 'в памяти этих сообщений уже нет, они с диска')
		assert.equal(feed.list({ involving: 'busy', limit: 10 }).length, 10, 'свежие читаются из памяти как раньше')
	})

	it('удаление сессии убирает файл источников', () => {
		const store = new MemoryStore()
		const orch = new Orchestrator({
			settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0 },
			store,
			spaceFactory: init => new FakeSpace(init.name, init.path, new FakeGateway()),
		})
		const s = orch.createSession({ title: 'Источники' })
		const source: SourceView = { id: 'x', kind: 'url', label: 'l', href: 'https://e.x', agentId: 'a', agentName: 'a', ts: 1, origin: 'reply' }
		store.appendSource(s.id, source)
		assert.equal(store.loadSources(s.id).length, 1)
		orch.removeSession(s.id)
		assert.equal(store.loadSources(s.id).length, 0)
	})
})
