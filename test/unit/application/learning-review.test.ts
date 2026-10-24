/** Дефекты ревью этапа 1: шторм агентов, точка отсчёта, чтение ленты, надгробия, целостность записи. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { finish, observe } from '../../support/signals'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { drainReads } from '../../support/read-blocks'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const MIN = 60_000
const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[]}</meta>'

const session = (id: string, patch: Partial<SessionView> = {}): SessionView => ({
	id,
	title: id,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0 + MIN).toISOString(),
	updatedAt: new Date(T0 + MIN).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
	...patch,
})

let seq = 0
const msg = (s: string, patch: Partial<Message> = {}): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text: `текст ${seq}`, hops: 0, session: s, ...patch }
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await new Promise<void>(r => setImmediate(r))
}

type Reply = { ok: boolean; text: string; error?: string }

describe('LearningService: ревью этапа 1', () => {
	let store: MemoryLearningStore
	let sessions: SessionView[]
	let feed: Message[]
	let calls: number
	let reads: number[]
	let reply: () => Promise<Reply>
	const clock = { t: T0 + MIN, now: () => clock.t }

	let current: LearningService | null = null
	/** false — агент падает, ничего не прочитав (иначе принятые блоки сохраняются, и повтор нечего собирать) */
	let drain = true
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => {
			reads.push(s)
			return feed.filter(m => m.seq > s)
		},
		lastSeq: () => feed.reduce((max, m) => Math.max(max, m.seq), 0),
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: async () => {
			if (drain) drainReads(current)
			calls += 1
			return { agentId: `ag${calls}`, ...(await reply()) }
		},
	}
	const make = (): LearningService => {
		store.settingsRaw = { stallMin: 0, ...(typeof store.settingsRaw === 'object' && store.settingsRaw !== null ? store.settingsRaw : {}) }
		const s = new LearningService({
			store,
			host,
			hub: new Hub(),
			clock,
			ids: { next: () => Math.random().toString(36).slice(2, 8) },
			defaultOn: true,
			claudeProjectsDir: '/p',
		})
		current = s
		s.load()
		return s
	}
	const caseState = (over: Partial<CaseState>): CaseState => ({
		id: 'c-s1',
		title: null,
		sessions: ['s1'],
		status: 'collecting',
		goals: [],
		events: 0,
		coveredUntil: 0,
		createdAt: new Date(T0).toISOString(),
		updatedAt: new Date(T0).toISOString(),
		closedAt: null,
		playbook: null,
		source: 'live',
		feedSeq: 0,
		transcripts: {},
		hinted: [],
		nextN: 1,
		lastEventAt: 0,
		lastRunAt: 0,
		nessyCalls: false,
		...over,
	})

	afterEach(() => {
		mock.timers.reset()
	})

	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout'] })
		seq = 0
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', '{{mode}}|{{total}}|{{summary}}')
		sessions = [session('s1')]
		feed = []
		calls = 0
		reads = []
		reply = () => Promise.resolve({ ok: true, text: GOOD })
		drain = true
		clock.t = T0 + MIN
	})

	it('1. постоянная ошибка агента: повторы идут по retrySec без конца и без шторма, слот за заданием, кейс closing', async () => {
		reply = () => Promise.resolve({ ok: false, text: '', error: 'сбой' })
		drain = false
		const svc = make()
		feed = [msg('s1')]
		finish(svc, 's1')
		for (let i = 0; i < 120; i++) {
			await flush()
			mock.timers.tick(30_000)
		}
		// за час раз в 60 с: ~60 запусков, не шторм
		assert.ok(calls > 50 && calls <= 62, `запусков ${calls}`)
		assert.equal(svc.getCase('c-s1').status, 'closing')
		const job = svc.view().jobs.find(j => j.kind === 'close')
		assert.equal(job?.status, 'running')
		assert.equal(job.error, 'сбой')
		assert.equal(
			svc.view().jobs.some(j => j.status === 'error'),
			false,
		)
		const before = calls
		reply = () => Promise.resolve({ ok: true, text: GOOD })
		drain = true
		for (let i = 0; i < 4; i++) {
			await flush()
			mock.timers.tick(30_000)
		}
		await flush()
		assert.equal(calls, before + 1) // первая же попытка после паузы удалась
		assert.equal(svc.view().jobs.find(j => j.id === job.id)?.status, 'done')
		assert.equal(svc.getCase('c-s1').status, 'ready')
	})

	it('2. первый запуск: старые сессии кейсов не заводят, новая — заводит, бэкфилл старой работает', async () => {
		const old = Array.from({ length: 50 }, (_, i) => session(`old${i}`, { createdAt: new Date(T0 - 3600_000).toISOString() }))
		sessions = old
		feed = old.flatMap(s => [msg(s.id), msg(s.id)])
		const svc = make()
		assert.deepEqual(store.meta, { startedAt: clock.t, startSeq: 100, removed: [] })
		observe(svc, 'old0')
		finish(svc, 'old0')
		assert.equal(svc.view().cases.length, 0)
		assert.equal(calls, 0)
		// новое сообщение в старой сессии тоже не заводит кейс
		feed.push(msg('old0'))
		observe(svc, 'old0')
		assert.equal(svc.view().cases.length, 0)
		// новая сессия
		sessions = [...old, session('fresh', { createdAt: new Date(clock.t).toISOString() })]
		feed.push(msg('fresh'))
		observe(svc, 'fresh')
		assert.deepEqual(
			svc.view().cases.map(c => c.id),
			['c-fresh'],
		)
		// ручной запуск по старой сессии заводит кейс (явное желание пользователя)
		svc.runNow('old1')
		await flush()
		assert.equal(svc.getCase('c-old1').status, 'ready')
		assert.equal(svc.getCase('c-old1').source, 'live')
	})

	it('2. точка отсчёта переживает рестарт, цепочка читается с startSeq', () => {
		feed = [msg('s1'), msg('s1')]
		make()
		assert.equal(store.meta?.startSeq, 2)
		sessions = [session('s1', { createdAt: new Date(clock.t + 1).toISOString() })]
		feed.push(msg('s1'))
		clock.t += 10
		finish(make(), 's1')
		const c = store.cases.get('c-s1')
		assert.equal(c?.events, 1, 'сообщения до точки отсчёта не берутся')
		assert.equal(store.meta.startSeq, 2)
	})

	it('3. activity ленту не читает; end читает один раз с курсора кейса (точка отсчёта), просмотренное не перечитывается', () => {
		const old = Array.from({ length: 20 }, (_, i) => session(`o${i}`, { createdAt: new Date(T0 - MIN).toISOString() }))
		sessions = [...old, session('s1')]
		feed = old.map(s => msg(s.id))
		const svc = make()
		feed.push(msg('s1', { from: 'a1', to: 'a2', kind: 'msg' })) // агент→агент: события нет
		feed.push(msg('s1', { from: 'a1', to: 'a2', kind: 'msg' }))
		reads = []
		observe(svc, 's1')
		observe(svc, 's1')
		assert.deepEqual(reads, [], 'хук активности ленту не трогает')
		feed.push(msg('s1'))
		finish(svc, 's1')
		assert.deepEqual(reads, [20])
		assert.equal(svc.getCase('c-s1').events, 1)
		assert.equal(svc.view().cases.length, 1)
	})

	it('4. ответ агента сохраняется в runs', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		const j = svc.runNow('c-s1')
		await flush()
		assert.equal(store.runs.get(`c-s1/${j.id}-1`), GOOD)
		assert.equal(svc.view().jobs.find(x => x.id === j.id)?.agentId, 'ag1')
	})

	it('5. удалённый кейс не воскресает; rebuild надгробия не ставит; возврат сессии в обучение снимает надгробие', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		svc.runNow('c-s1')
		await flush()
		svc.rebuild('c-s1')
		await flush()
		assert.ok(svc.getCase('c-s1'))
		assert.deepEqual(store.meta?.removed, [])
		svc.removeCase('c-s1')
		assert.deepEqual(store.meta.removed, ['s1'])
		feed.push(msg('s1'))
		observe(svc, 's1')
		svc.onSessionClosed('s1')
		assert.equal(svc.view().cases.length, 0)
		// надгробие переживает рестарт
		const again = make()
		observe(again, 's1')
		assert.equal(again.view().cases.length, 0)
		// off/on для сессии снимает надгробие
		again.updateSettings({ disabledSessions: ['s1'] })
		again.updateSettings({ disabledSessions: [] })
		assert.deepEqual(store.meta.removed, [])
		feed.push(msg('s1'))
		observe(again, 's1')
		assert.equal(again.view().cases.length, 1)
	})

	it('6. summary.md не записался: coveredUntil не сдвигается, задание падает (running, повтор); события не записались: курсор не двигается, кейс не удаляется, повтор по retrySec', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		store.writeSummary = (): boolean => false // диск не принимает только описание
		svc.runNow('c-s1')
		await flush()
		const c = svc.getCase('c-s1')
		assert.equal(c.coveredUntil, 0)
		assert.equal(svc.view().jobs[0]?.status, 'running')
		assert.match(svc.view().jobs[0]?.error ?? '', /summary/)
		// сбор события: appendRaw упал
		Reflect.deleteProperty(store, 'writeSummary')
		store.failWrites = true
		const other = (): LearningService => {
			store.cases.clear()
			store.jobs = []
			return make()
		}
		const svc2 = other()
		feed = [msg('s1')]
		observe(svc2, 's1')
		finish(svc2, 's1')
		assert.equal(svc2.getCase('c-s1').events, 0)
		assert.equal(svc2.getCase('c-s1').feedSeq, 0)
		assert.equal(svc2.view().jobs.length, 0)
		store.failWrites = false
		mock.timers.tick(60_000)
		await flush()
		assert.equal(svc2.getCase('c-s1').events, 1)
		assert.equal(svc2.getCase('c-s1').status, 'ready')
	})

	it('7. корень цепочки удалён: кейс тот же, дубля нет', async () => {
		sessions = [session('s1', { successor: 's2' }), session('s2')]
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		svc.runNow('c-s1')
		await flush()
		assert.equal(svc.getCase('c-s1').status, 'ready')
		assert.equal(svc.getCase('c-s1').rootId, 's1')
		sessions = [session('s2')]
		feed.push(msg('s2'))
		observe(svc, 's2')
		assert.deepEqual(
			svc.view().cases.map(c => c.id),
			['c-s1'],
		)
		assert.equal(svc.getCase('c-s1').status, 'collecting')
		finish(svc, 's2')
		assert.equal(svc.getCase('c-s1').events, 2)
	})

	it('7. старый кейс без rootId получает его из sessions', () => {
		store.saveCase(caseState({ sessions: ['x', 'y'], id: 'c-x' }))
		assert.equal(make().getCase('c-x').rootId, 'x')
	})

	it('8. транскрипт вне каталога проектов не читается', () => {
		sessions = [session('s1', { transcriptPath: '/etc/secret.jsonl' }), session('s2', { transcriptPath: '/p/ok.jsonl' })]
		const line =
			JSON.stringify({ type: 'user', uuid: 'u1', timestamp: new Date(T0).toISOString(), message: { content: [{ type: 'text', text: 'привет' }] } }) + '\n'
		store.files.set('/etc/secret.jsonl', line)
		store.files.set('/p/ok.jsonl', line)
		const svc = make()
		sessions = sessions.map(s => ({ ...s, createdAt: new Date(clock.t).toISOString() }))
		finish(svc, 's1', 's2')
		assert.equal(
			svc.view().cases.some(c => c.id === 'c-s1'),
			false,
		)
		assert.equal(svc.getCase('c-s2').events, 1)
	})

	it('9. при загрузке хвост raw/events.jsonl за nextN отрезается, повтор n — последняя запись', () => {
		store.saveCase(caseState({ events: 2, nextN: 3 }))
		const e = (n: number, text: string) => ({ n, ts: n, kind: 'task' as const, from: YOU, to: 'a1', text, ref: `r${n}` })
		store.raw.set('c-s1', [e(1, 'a'), e(2, 'b'), e(3, 'хвост'), e(4, 'хвост')])
		make()
		assert.deepEqual(
			store.readRaw('c-s1', 1).map(x => x.n),
			[1, 2],
		)
		store.raw.set('c-s1', [e(1, 'a'), e(2, 'старый'), e(2, 'новый')])
		assert.deepEqual(
			store.readRaw('c-s1', 1).map(x => x.text),
			['a', 'новый'],
		)
	})

	it('stop по таймауту: идущее задание возвращается в queued без траты попытки', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		reply = () => new Promise<Reply>(() => {})
		svc.runNow('c-s1')
		const p = svc.stop()
		mock.timers.tick(5000)
		await p
		const j = svc.view().jobs[0]
		assert.equal(j?.status, 'queued')
		assert.equal(j.attempts, 0)
		assert.equal(j.note, 'прервано остановкой')
		assert.equal(store.jobs[0]?.status, 'queued')
	})
})
