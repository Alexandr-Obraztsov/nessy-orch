/** Сервис обучения для API: настройки, удаление, пересборка, разбор прошлых сессий. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { MemoryLearningStore } from '../../support/memory-learning-store'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string, patch: Partial<SessionView> = {}): SessionView => ({
	id,
	title: `Сессия ${id}`,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0).toISOString(),
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
const line = (o: unknown): string => JSON.stringify(o)
const TRANSCRIPT =
	[
		line({ type: 'user', uuid: 'u1', timestamp: '2026-09-01T10:00:00Z', message: { role: 'user', content: 'сделай задачу' } }),
		line({ type: 'assistant', uuid: 'a1', timestamp: '2026-09-01T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'nessy-orch spawn --role x "y"' } }] } }),
		line({ type: 'user', uuid: 'u2', timestamp: '2026-09-01T10:00:02Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ответ агента' }] } }),
		line({ type: 'assistant', uuid: 'a2', timestamp: '2026-09-01T10:00:03Z', message: { role: 'assistant', content: [{ type: 'text', text: 'готово' }] } }),
	].join('\n') + '\n'

describe('LearningService: API', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let events: HubEvent[]
	let sessions: SessionView[]
	let feed: Message[]
	let hold: Promise<void> | null
	const clock = { t: T0 + 60_000, now: () => clock.t }
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		runAgent: async () => {
			if (hold) await hold
			return { agentId: 'ag1', ok: true, text: GOOD }
		},
	}
	const make = (): LearningService => {
		const s = new LearningService({ store, host, hub, clock, ids: { next: () => Math.random().toString(36).slice(2, 10) }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p' })
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
		assert.equal(store.summaries.get('c-s1'), '# T')
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

	it('кандидаты: сессии без кейса с сообщениями и транскрипты без известных чатов', () => {
		const svc = make()
		sessions = [session('s1'), session('s2'), session('s3')]
		feed = [msg('s1'), msg('s1'), msg('s2')]
		store.candidates = [
			{ kind: 'transcript', id: 'chat-s1', title: 'чат сессии', date: '2026-09-01T00:00:00.000Z', size: 10 },
			{ kind: 'transcript', id: 'old', title: 'старый', date: '2026-09-02T00:00:00.000Z', size: 20 },
		]
		svc.tick() // кейсы c-s1, c-s2 появились
		sessions = [...sessions, session('s4')]
		feed = [...feed, msg('s4')]
		const list = svc.backfillCandidates()
		assert.deepEqual(list.map(c => `${c.kind}:${c.id}`), ['session:s4', 'transcript:old'])
		assert.equal(list[0]?.size, 1)
	})

	it('backfill транскрипта: кейс c-t-…, source backfill, события из транскрипта, сразу final close; повтор — пропуск', async () => {
		const svc = make()
		store.candidates = [{ kind: 'transcript', id: 'chat.x', title: 'старый', date: '2026-09-02T00:00:00.000Z', size: 20 }]
		store.transcriptPaths.set('chat.x', '/p/a/chat.x.jsonl')
		store.files.set('/p/a/chat.x.jsonl', TRANSCRIPT)
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		const r = svc.backfill(['chat.x'])
		assert.deepEqual(r.skipped, [])
		assert.equal(r.created[0]?.id, 'c-t-chat_x')
		const st = store.cases.get('c-t-chat_x')
		assert.equal(st?.source, 'backfill')
		assert.equal(st.nessyCalls, true)
		assert.deepEqual(st.sessions, [])
		assert.deepEqual(Object.keys(st.transcripts), ['chat.x'])
		assert.equal(st.transcripts['chat.x']?.path, '/p/a/chat.x.jsonl')
		assert.equal(st.events, 3)
		assert.equal(store.raw.get('c-t-chat_x')?.filter(e => e.kind === 'call').length, 1)
		const job = svc.view().jobs[0]
		assert.equal(job?.kind, 'close')
		assert.equal(job.status, 'running')
		release()
		await flush()
		assert.equal(svc.getCase('c-t-chat_x').status, 'ready')
		assert.equal(svc.getCase('c-t-chat_x').coveredUntil, 3)
		// повтор: кандидата уже нет, но кейс есть — пропуск без дубля
		const again = svc.backfill(['chat.x'])
		assert.deepEqual(again, { created: [], skipped: [{ id: 'chat.x', reason: 'кейс уже есть' }] })
		assert.equal(svc.view().cases.length, 1)
		assert.throws(() => svc.backfill(['нет-такого']), { code: 'no_candidate', status: 404 })
	})

	it('backfill сессии: кейс backfill с feedSeq из ленты, итоговое задание', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1')]
		const list = svc.backfillCandidates()
		assert.deepEqual(list.map(c => c.id), ['s1'])
		const r = svc.backfill(['s1'])
		assert.equal(r.created[0]?.source, 'backfill')
		assert.equal(store.cases.get('c-s1')?.nessyCalls, false)
		await flush()
		const c = svc.getCase('c-s1')
		assert.equal(c.status, 'ready')
		assert.equal(c.coveredUntil, 2)
		assert.equal(c.source, 'backfill')
	})
})
