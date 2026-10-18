/** Исполнение заданий обучения: сборщик сессии, повторы, статусы кейса, насос, остановка. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it, mock } from 'node:test'
import type { HubEvent, Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { PORTION_CHARS } from '../../../src/domain/learning-settings'
import { MemoryLearningStore } from '../../support/memory-learning-store'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string, patch: Partial<SessionView> = {}): SessionView => ({
	id,
	title: id,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0 + 60_000).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
	...patch,
})

let seq = 0
const msg = (session: string, text = `текст ${seq + 1}`): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text, hops: 0, session }
}

const GOOD = (title = 'T'): string => `<summary>\n# ${title}\n</summary>\n<meta>{"title":"${title}","goals":[{"title":"g","type":"t"}]}</meta>`

type Reply = { ok: boolean; text: string; error?: string }
interface Call {
	name: string
	title: string
	prompt: string
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await new Promise<void>(r => setImmediate(r))
}

describe('LearningService: задания', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let events: HubEvent[]
	let sessions: SessionView[]
	let feed: Message[]
	let calls: Call[]
	/** ответы по порядку вызовов; функция может ждать промис */
	let script: Array<Reply | (() => Promise<Reply>)>
	const clock = { t: T0 + 60_000, now: () => clock.t }

	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		runAgent: async req => {
			calls.push(req)
			const step = script.shift() ?? { ok: true, text: GOOD() }
			const r = typeof step === 'function' ? await step() : step
			return { agentId: `ag${calls.length}`, ...r }
		},
	}

	const make = (tickMs = 0): LearningService => {
		const s = new LearningService({ store, host, hub, clock, ids: { next: () => `id${Math.random().toString(36).slice(2, 8)}` }, defaultOn: true, tickMs, claudeProjectsDir: '/p' })
		s.load()
		return s
	}
	const setSettings = (raw: unknown): void => {
		store.settingsRaw = raw
		store.mtimeMs += 1
	}
	/** управляемый ответ: вызвать `release()`, чтобы агент «ответил» */
	const gate = (reply: Reply = { ok: true, text: GOOD() }): { step: () => Promise<Reply>; release: () => void } => {
		let release = (): void => {}
		const p = new Promise<void>(r => {
			release = r
		})
		return { step: () => p.then(() => reply), release }
	}
	const jobs = (svc: LearningService) => svc.view().jobs

	beforeEach(() => {
		seq = 0
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', '{{mode}}|{{range}}|{{summary}}')
		hub = new Hub()
		events = []
		hub.subscribe(e => events.push(e))
		sessions = [session('s1')]
		feed = []
		calls = []
		script = []
		clock.t = T0 + 60_000
	})

	it('15 событий: одно collect, summary записан, coveredUntil = 15, learning_case опубликован', async () => {
		const svc = make()
		feed = Array.from({ length: 15 }, () => msg('s1'))
		svc.tick()
		clock.t += 61_000
		events.length = 0
		svc.tick()
		assert.equal(jobs(svc).length, 1)
		assert.equal(jobs(svc)[0]?.kind, 'collect')
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.deepEqual(jobs(svc)[0]?.range, [1, 15])
		await flush()
		assert.equal(calls.length, 1)
		assert.equal(calls[0]?.name, 'collector-c-s1')
		assert.equal(calls[0].title, 'Описание сессии: c-s1')
		assert.equal(store.summaries.get('c-s1'), '# T')
		const c = svc.getCase('c-s1')
		assert.equal(c.coveredUntil, 15)
		assert.equal(c.title, 'T')
		assert.deepEqual(c.goals, [{ title: 'g', type: 't' }])
		assert.equal(c.status, 'collecting')
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(jobs(svc)[0]?.agentId, 'ag1')
		assert.ok(events.some(e => e.t === 'learning_case' && e.case.coveredUntil === 15))
		assert.ok(events.some(e => e.t === 'learning_job' && e.job.status === 'done'))
		assert.equal(store.jobs[0]?.status, 'done')
		assert.equal(store.cases.get('c-s1')?.coveredUntil, 15)
	})

	it('ответ без <summary>: summary и coveredUntil не тронуты, повторы через 30 и 60 с, третий провал — error, retry ставит заново', async () => {
		const svc = make()
		store.summaries.set('c-s1', 'старое')
		feed = [msg('s1')]
		svc.tick()
		const bad: Reply = { ok: true, text: 'нет блока' }
		script = [bad, bad, bad, { ok: true, text: GOOD('Новый') }]
		const r = svc.runNow('c-s1')
		await flush()
		assert.equal(calls.length, 1)
		assert.equal(jobs(svc)[0]?.status, 'queued')
		assert.equal(jobs(svc)[0]?.attempts, 1)
		assert.equal(store.summaries.get('c-s1'), 'старое')
		assert.equal(svc.getCase('c-s1').coveredUntil, 0)
		clock.t += 29_000
		svc.tick()
		await flush()
		assert.equal(calls.length, 1) // 30 с ещё не прошло
		clock.t += 1_000
		svc.tick()
		await flush()
		assert.equal(calls.length, 2)
		assert.equal(jobs(svc)[0]?.attempts, 2)
		clock.t += 59_000
		svc.tick()
		await flush()
		assert.equal(calls.length, 2) // пауза 60 с
		clock.t += 1_000
		svc.tick()
		await flush()
		assert.equal(calls.length, 3)
		assert.equal(jobs(svc)[0]?.status, 'error')
		assert.match(jobs(svc)[0]?.error ?? '', /summary/)
		assert.equal(store.summaries.get('c-s1'), 'старое')
		svc.retry(r.id)
		assert.equal(jobs(svc)[0]?.status, 'running')
		await flush()
		assert.equal(calls.length, 4)
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(store.summaries.get('c-s1'), '# Новый')
	})

	it('ok: false и исключение — тоже провал с текстом', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		script = [{ ok: false, text: '', error: 'таймаут' }]
		svc.runNow('c-s1')
		await flush()
		assert.equal(jobs(svc)[0]?.error, 'таймаут')
		script = [() => Promise.reject(new Error('сеть'))]
		clock.t += 30_000
		svc.tick()
		await flush()
		assert.equal(jobs(svc)[0]?.error, 'сеть')
		assert.equal(jobs(svc)[0]?.attempts, 2)
	})

	it('onSessionClosed → close; после ответа ready с closedAt; новое событие → collecting, следующий close дописывает', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1')]
		svc.tick()
		svc.onSessionClosed('s1')
		assert.equal(jobs(svc)[0]?.kind, 'close')
		assert.equal(svc.getCase('c-s1').status, 'closing')
		assert.match(calls[0]?.prompt ?? '', /^final:/)
		await flush()
		const c = svc.getCase('c-s1')
		assert.equal(c.status, 'ready')
		assert.equal(c.closedAt, new Date(clock.t).toISOString())
		assert.equal(c.coveredUntil, 2)
		feed.push(msg('s1'))
		script = [{ ok: true, text: GOOD('Два') }]
		clock.t += 61_000 // пауза между запусками
		svc.tick()
		assert.equal(svc.getCase('c-s1').status, 'collecting')
		assert.equal(svc.getCase('c-s1').closedAt, null)
		await flush()
		assert.match(calls[1]?.prompt ?? '', /^incremental:/)
		assert.equal(svc.getCase('c-s1').coveredUntil, 3)
		feed.push(msg('s1'))
		svc.onSessionClosed('s1')
		assert.match(calls[2]?.prompt ?? '', /^final:.*\|n 4–4\|# Два$/) // только новые события, прежнее описание ушло в промпт
		await flush()
		assert.equal(svc.getCase('c-s1').status, 'ready')
	})

	it('порция больше PORTION_CHARS: два задания подряд, курсор доходит до конца', async () => {
		const svc = make()
		const total = Math.ceil((PORTION_CHARS / 2000) * 1.5)
		feed = Array.from({ length: total }, () => msg('s1', 'x'.repeat(2500)))
		svc.tick()
		svc.onSessionClosed('s1')
		await flush()
		assert.equal(calls.length, 2)
		assert.equal(jobs(svc).filter(j => j.status === 'done').length, 2)
		const first = jobs(svc)[0]?.range
		const second = jobs(svc)[1]?.range
		assert.equal(second?.[0], (first?.[1] ?? 0) + 1)
		assert.equal(second[1], total)
		const c = svc.getCase('c-s1')
		assert.equal(c.coveredUntil, total)
		assert.equal(c.status, 'ready') // final и всё покрыто — только после последней порции
		assert.ok(jobs(svc).every(j => j.kind === 'close'))
	})

	it('maxAgents: 2, три кейса — третий ждёт queued, пока не освободится место', async () => {
		setSettings({ maxAgents: 2 })
		sessions = [session('s1'), session('s2'), session('s3')]
		const svc = make()
		feed = [msg('s1'), msg('s2'), msg('s3')]
		svc.tick()
		const gates = [gate(), gate(), gate()]
		script = gates.map(g => g.step)
		svc.runNow('s1')
		svc.runNow('s2')
		svc.runNow('s3')
		await flush()
		assert.deepEqual(jobs(svc).map(j => j.status), ['running', 'running', 'queued'])
		assert.equal(calls.length, 2)
		gates[0]?.release()
		await flush()
		assert.deepEqual(jobs(svc).map(j => j.status), ['done', 'running', 'running'])
		assert.equal(calls.length, 3)
		gates[1]?.release()
		gates[2]?.release()
		await flush()
		assert.ok(jobs(svc).every(j => j.status === 'done'))
	})

	it('рестарт: running → queued с note, исполнение с прежнего coveredUntil', async () => {
		const first = make()
		feed = Array.from({ length: 5 }, () => msg('s1'))
		first.tick()
		const c = first.getCase('c-s1')
		store.saveCase({ ...c, coveredUntil: 3 })
		const running: JobState = {
			id: 'j-old',
			kind: 'close',
			caseId: 'c-s1',
			subject: 'c-s1',
			status: 'running',
			attempts: 0,
			agentId: 'ag0',
			error: null,
			note: null,
			range: [4, 5],
			createdAt: new Date(T0).toISOString(),
			startedAt: new Date(T0).toISOString(),
			finishedAt: null,
			final: true,
			retryAt: null,
			payload: null,
		}
		store.jobs = [running]
		store.prompts.set('session-collector', '{{range}}|{{events}}')
		const svc = make()
		assert.equal(jobs(svc)[0]?.status, 'queued')
		assert.equal(jobs(svc)[0]?.note, 'прервано перезапуском')
		assert.equal(store.jobs[0]?.status, 'queued')
		assert.equal(calls.length, 0)
		svc.start()
		await flush()
		assert.equal(calls.length, 1)
		assert.match(calls[0]?.prompt ?? '', /^n 4–5\|/)
		assert.ok(!(calls[0]?.prompt ?? '').includes('[3]'))
		assert.equal(svc.getCase('c-s1').status, 'ready')
		await svc.stop()
	})

	it('enabled: false посреди running: задание доходит до конца, новых нет; disabledSessions: [s2] не мешает s1', async () => {
		sessions = [session('s1'), session('s2')]
		const svc = make()
		feed = [msg('s1'), msg('s2')]
		svc.tick()
		const g = gate()
		script = [g.step]
		svc.runNow('s1')
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'running')
		calls = []
		setSettings({ enabled: false })
		feed.push(msg('s1'))
		clock.t += 40 * 60_000
		svc.tick()
		svc.onSessionClosed('s2')
		assert.equal(jobs(svc).length, 1)
		g.release()
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(jobs(svc).length, 1)
		assert.equal(svc.getCase('c-s1').coveredUntil, 1)
		// явная команда работает и при выключенном
		const j = svc.runNow('c-s2')
		assert.equal(j.kind, 'close')
		await flush()
		assert.equal(svc.getCase('c-s2').status, 'ready')

		setSettings({ disabledSessions: ['s2'] })
		store.jobs = []
		store.cases.clear()
		const other = make()
		feed = [msg('s1'), msg('s2')]
		calls = []
		clock.t += 40 * 60_000
		other.tick()
		other.onSessionClosed('s2')
		other.onSessionClosed('s1')
		await flush()
		assert.equal(calls.length, 1)
		assert.ok(other.view().jobs.every(j => j.caseId === 'c-s1'))
		assert.equal(other.view().cases.some(c => c.id === 'c-s2'), false)
	})

	it('isProtected: true, пока кейс не ready', async () => {
		sessions = [session('s1'), session('s2')]
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		assert.equal(svc.isProtected('s1'), true) // collecting
		assert.equal(svc.isProtected('s2'), false) // кейса нет
		svc.onSessionClosed('s1')
		assert.equal(svc.isProtected('s1'), true) // closing
		await flush()
		assert.equal(svc.isProtected('s1'), false) // ready
	})

	it('close упал окончательно: кейс error (не защищает сессию), retry переводит в closing', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		const bad: Reply = { ok: false, text: '', error: 'сбой' }
		script = [bad, bad, bad]
		svc.onSessionClosed('s1')
		for (let i = 0; i < 2; i++) {
			await flush()
			clock.t += 61_000
			svc.tick()
		}
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'error')
		assert.equal(svc.getCase('c-s1').status, 'error')
		assert.equal(svc.isProtected('s1'), false) // события уже в raw/
		const id = jobs(svc)[0]?.id ?? ''
		script = [gate().step]
		svc.retry(id)
		assert.equal(svc.getCase('c-s1').status, 'closing')
	})

	it('кейс в error + новое событие: событие собрано, но заданий нет; runNow возвращает в работу', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		const c = svc.getCase('c-s1')
		store.saveCase({ ...c, status: 'error' })
		const svc2 = make()
		feed.push(msg('s1'))
		clock.t += 40 * 60_000
		svc2.tick()
		assert.equal(svc2.getCase('c-s1').status, 'error')
		assert.equal(svc2.getCase('c-s1').events, 2)
		assert.equal(svc2.view().jobs.length, 0)
		svc2.runNow('c-s1')
		assert.equal(svc2.getCase('c-s1').status, 'closing')
		await flush()
		assert.equal(svc2.getCase('c-s1').status, 'ready')
	})

	it('final с пустой порцией: нет описания и событий — кейс удалён; есть описание — ready', async () => {
		const empty: CaseState = {
			id: 'c-e',
			title: null,
			sessions: ['e'],
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
		}
		store.saveCase(empty)
		store.saveCase({ ...empty, id: 'c-d', sessions: ['d'], events: 2, coveredUntil: 2 })
		store.summaries.set('c-d', '# Описание')
		sessions = []
		const svc = make()
		svc.runNow('c-e')
		svc.runNow('c-d')
		await flush()
		assert.equal(calls.length, 0) // агент не нужен
		assert.throws(() => svc.getCase('c-e'))
		assert.ok(!store.cases.has('c-e'))
		assert.ok(events.some(e => e.t === 'learning_case_removed' && e.id === 'c-e'))
		assert.equal(svc.getCase('c-d').status, 'ready')
		assert.ok(svc.getCase('c-d').closedAt)
		assert.ok(jobs(svc).every(j => j.status === 'done'))
	})

	it('stop: новых заданий не берёт, ждёт идущее', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s2')]
		sessions = [session('s1'), session('s2')]
		svc.tick()
		const g = gate()
		script = [g.step]
		svc.start()
		svc.runNow('s1')
		await flush()
		let stopped = false
		const p = svc.stop().then(() => {
			stopped = true
		})
		await flush()
		assert.equal(stopped, false)
		svc.runNow('s2') // после stop насос не работает
		g.release()
		await p
		assert.equal(stopped, true)
		assert.equal(calls.length, 1)
		assert.equal(jobs(svc).find(j => j.caseId === 'c-s2')?.status, 'queued')
	})

	it('stop не ждёт дольше 5 с', async () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			const svc = make()
			feed = [msg('s1')]
			svc.tick()
			script = [() => new Promise<Reply>(() => {})]
			svc.runNow('s1')
			let stopped = false
			const p = svc.stop().then(() => {
				stopped = true
			})
			await flush()
			assert.equal(stopped, false)
			mock.timers.tick(5000)
			await p
			assert.equal(stopped, true)
		} finally {
			mock.timers.reset()
		}
	})

	it('start с tickMs > 0 запускает таймер tick, stop его снимает', async () => {
		mock.timers.enable({ apis: ['setInterval'] })
		try {
			const svc = make(1000)
			feed = [msg('s1')]
			svc.start()
			assert.equal(svc.view().cases.length, 0)
			mock.timers.tick(1000)
			assert.equal(svc.view().cases.length, 1)
			await svc.stop()
			feed.push(msg('s1'))
			mock.timers.tick(5000)
			assert.equal(svc.getCase('c-s1').events, 1)
		} finally {
			mock.timers.reset()
		}
	})
})
