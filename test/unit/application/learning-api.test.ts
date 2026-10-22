/** Сервис обучения для API: настройки, удаление, пересборка. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { drainReads } from '../../support/read-blocks'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string, patch: Partial<SessionView> = {}): SessionView => ({
	id,
	title: `Сессия ${id}`,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0 + 60_000).toISOString(),
	updatedAt: new Date(T0 + 5000).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
	...patch,
})

let seq = 0
const msg = (s: string): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text: `текст ${seq}`, hops: 0, session: s }
}

const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[]}</meta>'
const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await new Promise<void>(r => setImmediate(r))
}

describe('LearningService: API', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let events: HubEvent[]
	let sessions: SessionView[]
	let feed: Message[]
	let hold: Promise<void> | null
	const clock = { t: T0 + 60_000, now: () => clock.t }
	let current: LearningService | null = null
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: async () => {
			if (hold) await hold
			drainReads(current)
			return { agentId: 'ag1', ok: true, text: GOOD }
		},
	}
	const make = (): LearningService => {
		const s = new LearningService({ store, host, hub, clock, ids: { next: () => Math.random().toString(36).slice(2, 10) }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p' })
		current = s
		s.load()
		return s
	}

	beforeEach(() => {
		seq = 0
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', '{{mode}}|{{range}}|{{summary}}')
		hub = new Hub()
		events = []
		hub.subscribe(e => events.push(e))
		sessions = [session('s1')]
		feed = []
		hold = null
		clock.t = T0 + 60_000
	})

	it('updateSettings: сохраняет, публикует learning_settings, не перечитывает свой файл; неверный тип — 400', () => {
		const svc = make()
		const next = svc.updateSettings({ enabled: false, intervalMin: 5 })
		assert.equal(next.enabled, false)
		assert.equal(svc.getSettings().intervalMin, 5)
		assert.deepEqual(store.settingsRaw, next)
		assert.ok(events.some(e => e.t === 'learning_settings' && !e.settings.enabled))
		svc.tick()
		assert.equal(svc.getSettings().enabled, false)
		assert.throws(() => svc.updateSettings({ enabled: 'да' }), { code: 'bad_request', status: 400 })
	})

	it('getCaseDetail: summary и notes; нет кейса — 404 no_case', () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		store.summaries.set('c-s1', '# описание')
		store.notes.set('c-s1', 'заметка')
		const d = svc.getCaseDetail('c-s1')
		assert.equal(d.summary, '# описание')
		assert.equal(d.notes, 'заметка')
		assert.equal(d.id, 'c-s1')
		assert.throws(() => svc.getCaseDetail('нет'), { code: 'no_case', status: 404 })
		assert.throws(() => svc.runNow('нет'), { code: 'no_case', status: 404 })
		assert.throws(() => svc.retry('нет'), { code: 'no_job', status: 404 })
	})

	it('removeCase: во время задания 409 case_busy, потом удаляет кейс, файлы и ждущие задания', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.runNow('s1')
		assert.equal(svc.view().jobs[0]?.status, 'running')
		assert.throws(() => svc.removeCase('c-s1'), { code: 'case_busy', status: 409 })
		release()
		await flush()
		events.length = 0
		svc.removeCase('c-s1')
		assert.equal(svc.view().cases.length, 0)
		assert.ok(!store.cases.has('c-s1'))
		assert.ok(events.some(e => e.t === 'learning_case_removed' && e.id === 'c-s1'))
		assert.throws(() => svc.removeCase('c-s1'), { code: 'no_case' })
	})

	it('rebuild: сбрасывает coveredUntil и summary, ставит итоговый close', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1')]
		svc.runNow('s1')
		await flush()
		assert.equal(svc.getCase('c-s1').coveredUntil, 2)
		assert.equal(svc.getCase('c-s1').status, 'ready')
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		const job = svc.rebuild('c-s1')
		assert.equal(job.kind, 'close')
		assert.equal(store.summaries.get('c-s1'), '')
		assert.equal(svc.getCase('c-s1').coveredUntil, 0)
		assert.throws(() => svc.rebuild('c-s1'), { code: 'case_busy' })
		release()
		await flush()
		assert.equal(svc.getCase('c-s1').coveredUntil, 2)
		assert.match(store.summaries.get('c-s1') ?? '', /^# T\n## Goal/)
	})

	it('runAll: close по всем незакрытым кейсам', async () => {
		const svc = make()
		sessions = [session('s1'), session('s2')]
		feed = [msg('s1'), msg('s2')]
		svc.tick()
		const jobs = svc.runAll()
		assert.equal(jobs.length, 2)
		assert.ok(jobs.every(j => j.kind === 'close'))
		await flush()
		assert.ok(svc.view().cases.every(c => c.status === 'ready'))
		assert.equal(svc.runAll().length, 0)
	})
})
