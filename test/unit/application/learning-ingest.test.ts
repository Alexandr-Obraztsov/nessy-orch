import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, Message, SessionView } from '../../../shared/types'
import { caseIdOf, chainOf } from '../../../src/application/learning/case-ingest'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { LearningService } from '../../../src/application/learning/learning.service'
import { Hub } from '../../../src/application/hub'
import { SERVICE_SESSION, USER, YOU } from '../../../src/domain/constants'
import { MemoryLearningStore } from '../../support/memory-learning-store'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string, patch: Partial<SessionView> = {}): SessionView => ({
	id,
	title: id,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
	...patch,
})

let seq = 0
const msg = (patch: Partial<Message> & { session: string }): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text: `текст ${seq}`, hops: 0, ...patch }
}

const line = (uuid: string, type: 'user' | 'assistant', text: string, sec: number): string =>
	JSON.stringify({ type, uuid, timestamp: new Date(T0 + sec * 1000).toISOString(), message: { content: [{ type: 'text', text }] } }) + '\n'

describe('chainOf', () => {
	const ss = [session('s1', { successor: 's2' }), session('s2', { successor: 's3' }), session('s3'), session('x')]
	it('корень → последняя, из любого звена', () => {
		assert.deepEqual(chainOf(ss, 's2'), ['s1', 's2', 's3'])
		assert.deepEqual(chainOf(ss, 's3'), ['s1', 's2', 's3'])
		assert.deepEqual(chainOf(ss, 'x'), ['x'])
		assert.equal(caseIdOf('s1'), 'c-s1')
	})
	it('цикл не зацикливает', () => {
		const loop = [session('a', { successor: 'b' }), session('b', { successor: 'a' })]
		assert.equal(chainOf(loop, 'a').length, 2)
	})
})

describe('LearningService: сбор событий', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let sessions: SessionView[]
	let feed: Message[]
	let busy: boolean
	let svc: LearningService
	let events: HubEvent[]
	let prompts: string[]
	const clock = { t: T0 + 60_000, now: () => clock.t }

	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => busy,
		// сборщик не отвечает: задания остаются в работе, видно только что поставлено
		runAgent: req => {
			prompts.push(req.prompt)
			return new Promise(() => {})
		},
	}
	const jobs = (): Array<[string, string, string]> => svc.view().jobs.map(j => [j.kind, j.caseId, j.status])

	beforeEach(() => {
		seq = 0
		store = new MemoryLearningStore()
		hub = new Hub()
		events = []
		prompts = []
		store.prompts.set('session-collector', '{{mode}}')
		hub.subscribe(e => events.push(e))
		sessions = [session('s1', { transcriptPath: '/t/s1.jsonl' })]
		feed = []
		busy = false
		clock.t = T0 + 60_000
		svc = new LearningService({ store, host, hub, clock, ids: { next: () => 'id' }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p' })
		svc.load()
	})

	it('лента и транскрипт: кейс c-s1, события 1…4 по времени, курсоры сдвинуты', () => {
		feed = [msg({ session: 's1', ts: T0 + 2000 }), msg({ session: 's1', ts: T0 + 4000, from: 'a1', to: YOU, kind: 'reply' })]
		store.files.set('/t/s1.jsonl', line('u1', 'user', 'привет', 1) + line('u2', 'assistant', 'ответ', 3))
		svc.tick()
		const c = svc.getCase('c-s1')
		assert.equal(c.events, 4)
		assert.deepEqual(store.readRaw('c-s1', 1).map(e => [e.n, e.kind]), [[1, 'user'], [2, 'task'], [3, 'claude'], [4, 'reply']])
		assert.equal(c.feedSeq, 2)
		assert.equal(c.transcripts['chat-s1']?.offset, Buffer.byteLength(store.files.get('/t/s1.jsonl') ?? ''))
		assert.equal(c.status, 'collecting')
		assert.ok(events.some(e => e.t === 'learning_case'))
		assert.equal(svc.view().cases.length, 1)
		assert.deepEqual(svc.view().jobs, [])
	})

	it('повторный tick без данных событий не добавляет', () => {
		feed = [msg({ session: 's1' })]
		svc.tick()
		const published = events.length
		svc.tick()
		assert.equal(svc.getCase('c-s1').events, 1)
		assert.equal(store.readRaw('c-s1', 1).length, 1)
		assert.equal(events.length, published)
	})

	it('преемник /clear: событие второй сессии попадает в тот же кейс', () => {
		feed = [msg({ session: 's1' })]
		svc.tick()
		sessions = [session('s1', { successor: 's2' }), session('s2')]
		feed.push(msg({ session: 's2' }))
		svc.tick()
		const c = svc.getCase('c-s1')
		assert.deepEqual(c.sessions, ['s1', 's2'])
		assert.equal(c.events, 2)
		assert.equal(svc.view().cases.length, 1)
	})

	it('служебная сессия и агент→агент в кейс не попадают', () => {
		sessions = [session('s1')]
		feed = [msg({ session: SERVICE_SESSION }), msg({ session: 's1', from: 'a1', to: 'a2' }), msg({ session: 's1', from: 'system', kind: 'event' })]
		svc.tick()
		assert.equal(svc.view().cases.length, 0)
		feed.push(msg({ session: 's1', from: USER }))
		svc.tick()
		assert.equal(svc.getCase('c-s1').events, 1)
		assert.equal(svc.getCase('c-s1').feedSeq, 4)
	})

	it('disabledSessions: кейса нет; enabled=false тоже', () => {
		feed = [msg({ session: 's1' })]
		store.settingsRaw = { disabledSessions: ['s1'] }
		store.mtimeMs = 1
		svc.tick()
		assert.equal(svc.view().cases.length, 0)
		store.settingsRaw = { enabled: false }
		store.mtimeMs = 2
		svc.tick()
		assert.equal(svc.view().cases.length, 0)
		assert.equal(svc.getSettings().enabled, false)
	})

	it('нет файла настроек: enabled = defaultOn', () => {
		const off = new LearningService({ store, host, hub, clock, ids: { next: () => 'id' }, defaultOn: false, tickMs: 0, claudeProjectsDir: '/p' })
		off.load()
		feed = [msg({ session: 's1' })]
		off.tick()
		assert.equal(off.view().cases.length, 0)
	})

	it('15 событий запускают сбор после паузы', () => {
		feed = Array.from({ length: 15 }, () => msg({ session: 's1' }))
		svc.tick()
		assert.deepEqual(jobs(), []) // пауза 60 с после заведения кейса
		clock.t += 61_000
		svc.tick()
		assert.deepEqual(jobs(), [['collect', 'c-s1', 'running']])
		assert.match(prompts[0] ?? '', /incremental/)
		svc.tick()
		assert.equal(jobs().length, 1) // по кейсу задание уже идёт
	})

	it('простой закрывает кейс', () => {
		feed = [msg({ session: 's1' })]
		svc.tick()
		clock.t += 31 * 60_000
		svc.tick()
		assert.deepEqual(jobs(), [['close', 'c-s1', 'running']])
		assert.match(prompts[0] ?? '', /final: finish/)
		assert.equal(svc.getCase('c-s1').status, 'closing')
	})

	it('занятость блокирует close (остаётся только сбор по интервалу)', () => {
		feed = [msg({ session: 's1' })]
		svc.tick()
		clock.t += 31 * 60_000
		busy = true
		svc.tick()
		assert.deepEqual(jobs(), [['collect', 'c-s1', 'running']])
		assert.match(prompts[0] ?? '', /incremental/)
	})

	it('ready + новое событие → collecting и collect', () => {
		feed = [msg({ session: 's1' })]
		svc.tick()
		const c = svc.getCase('c-s1')
		store.saveCase({ ...c, status: 'ready', coveredUntil: 1, closedAt: new Date(T0).toISOString() })
		const svc2 = new LearningService({ store, host, hub, clock, ids: { next: () => 'id' }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p' })
		svc2.load()
		feed.push(msg({ session: 's1' }))
		svc2.tick()
		assert.equal(svc2.getCase('c-s1').status, 'collecting')
		assert.equal(svc2.getCase('c-s1').closedAt, null)
		assert.deepEqual(svc2.view().jobs.map(j => [j.kind, j.caseId, j.status]), [['collect', 'c-s1', 'running']])
		assert.match(prompts[0] ?? '', /incremental/)
	})
})
