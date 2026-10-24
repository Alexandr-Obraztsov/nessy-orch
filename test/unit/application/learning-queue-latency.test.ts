/** Очередь обучения по событиям: мгновенный запуск, срок простоя, повтор через retrySec тем же агентом, сторож stallMin. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { stubCollect } from '../../support/stub-collect'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[]}</meta>'
const MIN = 60_000

const flush = async (): Promise<void> => {
	for (let i = 0; i < 6; i++) await new Promise<void>(r => setImmediate(r))
}

type Reply = { ok: boolean; text: string; error?: string }

describe('очередь обучения: события и таймеры', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let sessions: SessionView[]
	let feed: Message[]
	let seq: number
	/** ответы агентов по порядку вызовов; функция — управляемый ответ */
	let script: Array<Reply | (() => Promise<Reply>)>
	let calls: number
	let cancelled: string[]
	/** вызовы runAgent: какой агент продолжен и с каким текстом */
	let reqs: Array<{ agentId: string | undefined; prompt: string }>
	let notes: Array<{ id: string; text: string; level: string }>
	let alive: boolean
	let activity: Map<string, number>
	const clock = { now: (): number => Date.now() }

	const session = (id: string): SessionView => ({
		id,
		title: id,
		owner: null,
		status: 'active',
		summary: null,
		createdAt: new Date(T0 + 60_000).toISOString(),
		updatedAt: new Date(T0).toISOString(),
		sources: 0,
		chatId: `chat-${id}`,
	})
	const msg = (s: string): Message => ({ seq: ++seq, id: `m${seq}`, ts: Date.now(), from: YOU, to: 'a1', kind: 'msg', text: `t${seq}`, hops: 0, session: s })
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: id => {
			cancelled.push(id)
			return Promise.resolve()
		},
		agentAlive: () => alive,
		noteAgent: (id, text, level) => void notes.push({ id, text, level }),
		agentActivity: id => activity.get(id) ?? null,
		releaseAgent: () => Promise.resolve(),
		runAgent: async req => {
			calls += 1
			reqs.push({ agentId: req.agentId, prompt: req.prompt })
			const id = req.agentId ?? `ag${calls}`
			req.onSpawn?.(id)
			const step = script.shift() ?? { ok: true, text: GOOD }
			const r = typeof step === 'function' ? await step() : step
			return { agentId: id, ...r }
		},
	}
	const make = (settings: Record<string, unknown> = {}): LearningService => {
		store.settingsRaw = settings
		store.mtimeMs += 1
		const s = new LearningService({
			store,
			host,
			hub,
			clock,
			ids: { next: () => Math.random().toString(36).slice(2, 10) },
			defaultOn: true,
			claudeProjectsDir: '/p',
		})
		s.registerHandler(stubCollect)
		s.load()
		return s
	}
	const jobs = (s: LearningService) => s.view().jobs
	/** прокрутка времени с досрочной раздачей микрозадач (таймеры и промисы чередуются) */
	const advance = async (ms: number): Promise<void> => {
		mock.timers.tick(ms)
		await flush()
	}
	const act = (svc: LearningService, id = 's1'): void => svc.signal({ event: 'activity', session: id })

	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 + 60_000 })
		seq = 0
		calls = 0
		cancelled = []
		reqs = []
		notes = []
		alive = true
		activity = new Map()
		script = []
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', '{{mode}}|{{total}}|{{summary}}')
		hub = new Hub()
		sessions = [session('s1'), session('s2')]
		feed = []
	})
	afterEach(() => {
		mock.timers.reset()
	})

	it('свободный слот: сигнал end сразу даёт running (синхронно, без тика и ожидания)', () => {
		const svc = make()
		feed = [msg('s1')]
		script = [() => new Promise(() => {})]
		svc.signal({ event: 'end', session: 's1' })
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.equal(jobs(svc)[0]?.kind, 'close')
		assert.equal(calls, 1)
		assert.equal(svc.getCase('c-s1').status, 'closing')
	})

	it('таймер простоя: сессия без работы idleMin уходит в очередь; активность сдвигает срок', async () => {
		const svc = make({ idleMin: 30 })
		svc.start()
		feed = [msg('s1')]
		script = [() => new Promise(() => {})]
		act(svc)
		await advance(20 * MIN)
		act(svc) // работа: срок пересчитан от этого момента
		await advance(29 * MIN)
		assert.equal(jobs(svc).length, 0)
		assert.equal(svc.getCase('c-s1').status, 'collecting')
		await advance(1 * MIN)
		assert.equal(jobs(svc).length, 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.equal(svc.getCase('c-s1').status, 'closing')
		const stopped = svc.stop()
		mock.timers.tick(5_000)
		await stopped
	})

	it('таймер простоя один на ближайший срок: после первой сессии срабатывает вторая', async () => {
		const svc = make({ idleMin: 30, maxAgents: 2 })
		svc.start()
		feed = [msg('s1'), msg('s2')]
		script = [() => new Promise(() => {}), () => new Promise(() => {})]
		act(svc, 's1')
		await advance(10 * MIN)
		act(svc, 's2')
		await advance(20 * MIN)
		assert.deepEqual(
			jobs(svc).map(j => j.caseId),
			['c-s1'],
		)
		await advance(10 * MIN)
		assert.deepEqual(
			jobs(svc).map(j => j.caseId),
			['c-s1', 'c-s2'],
		)
		const stopped = svc.stop()
		mock.timers.tick(5_000)
		await stopped
	})

	it('рестарт: открытый кейс с истёкшим сроком простоя закрывается сразу после start', async () => {
		const first = make({ idleMin: 30 })
		feed = [msg('s1')]
		act(first)
		await first.stop()
		await advance(31 * MIN)
		const svc = make({ idleMin: 30 })
		script = [() => new Promise(() => {})]
		svc.start()
		await advance(0)
		assert.equal(jobs(svc)[0]?.status, 'running')
		const stopped = svc.stop()
		mock.timers.tick(5_000)
		await stopped
	})

	it('провал: задание остаётся running и держит слот, ошибка в диалоге агента; повтор через retrySec тем же агентом', async () => {
		const svc = make({ maxAgents: 1, retrySec: 60 })
		feed = [msg('s1'), msg('s2')]
		script = [
			{ ok: false, text: '', error: 'сбой' },
			{ ok: true, text: GOOD },
		]
		svc.signal({ event: 'end', session: 's1' })
		svc.signal({ event: 'end', session: 's2' })
		await flush()
		assert.equal(calls, 1)
		assert.deepEqual(
			jobs(svc).map(j => [j.status, j.attempts]),
			[
				['running', 1],
				['queued', 0],
			],
		)
		assert.match(jobs(svc)[0]?.error ?? '', /сбой/)
		assert.ok(notes.some(n => n.id === 'ag1' && n.level === 'error' && /сбой/.test(n.text)))
		await advance(59_999)
		assert.equal(calls, 1)
		assert.equal(jobs(svc)[1]?.status, 'queued') // слот не освободился
		await advance(1)
		// повтор — сообщение тому же агенту, не новый агент
		assert.equal(reqs[1]?.agentId, 'ag1')
		assert.match(reqs[1].prompt, /Previous attempt failed: сбой/)
		assert.equal(jobs(svc)[0]?.status, 'done')
		// слот освободился — второе пошло сразу
		assert.equal(calls, 3)
		assert.equal(jobs(svc)[1]?.status, 'done')
	})

	it('повтор без живого агента: новый агент с полным поручением; число повторов не ограничено', async () => {
		const svc = make({ retrySec: 5 })
		alive = false
		feed = [msg('s1')]
		script = [
			{ ok: false, text: '', error: 'e1' },
			{ ok: false, text: '', error: 'e2' },
			{ ok: false, text: '', error: 'e3' },
		]
		svc.signal({ event: 'end', session: 's1' })
		await flush()
		for (let i = 0; i < 3; i++) await advance(5_000)
		assert.equal(calls, 4)
		assert.equal(reqs[1]?.agentId, undefined)
		assert.doesNotMatch(reqs[1]?.prompt ?? '', /Previous attempt failed/)
		assert.equal(jobs(svc)[0]?.attempts, 3)
		assert.equal(jobs(svc)[0]?.status, 'done')
	})

	it('слот освободился — следующее задание стартует сразу', async () => {
		const svc = make({ maxAgents: 1 })
		feed = [msg('s1'), msg('s2')]
		let release = (): void => {}
		script = [() => new Promise<Reply>(r => (release = () => r({ ok: true, text: GOOD })))]
		svc.runNow('s1')
		svc.runNow('s2')
		assert.deepEqual(
			jobs(svc).map(j => j.status),
			['running', 'queued'],
		)
		release()
		await flush()
		assert.equal(calls, 2)
		assert.deepEqual(
			jobs(svc).map(j => j.status),
			['done', 'done'],
		)
	})

	it('сторож stallMin > 0: агент молчит — попытка провалена, агент отменён, задание running, повтор по retrySec; поздний итог игнорируется', async () => {
		const svc = make({ stallMin: 5, retrySec: 30 })
		feed = [msg('s1')]
		let late = (): void => {}
		script = [() => new Promise<Reply>(r => (late = () => r({ ok: true, text: GOOD }))), { ok: true, text: GOOD }]
		svc.runNow('s1')
		await advance(5 * MIN - 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.deepEqual(cancelled, [])
		await advance(1)
		const first = jobs(svc)[0]
		assert.deepEqual(cancelled, ['ag1'])
		assert.equal(first?.status, 'running')
		assert.equal(first.attempts, 1)
		assert.match(first.error ?? '', /нет событий агента 5 мин/)
		// поздний ответ снятого агента ничего не меняет
		late()
		await flush()
		assert.equal(jobs(svc)[0]?.attempts, 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		await advance(30_000)
		assert.equal(reqs[1]?.agentId, 'ag1')
		assert.equal(jobs(svc)[0]?.status, 'done')
	})

	it('сторож: события агента продлевают срок (смотрим активность агента)', async () => {
		const svc = make({ stallMin: 5 })
		feed = [msg('s1')]
		script = [() => new Promise<Reply>(() => {})]
		svc.runNow('s1')
		await advance(4 * MIN)
		activity.set('ag1', Date.now())
		await advance(4 * MIN)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.deepEqual(cancelled, [])
		await advance(1 * MIN)
		assert.deepEqual(cancelled, ['ag1'])
		assert.equal(jobs(svc)[0]?.attempts, 1)
	})

	it('сторож stallMin = 0: выключен, агент не снимается сколько бы ни молчал', async () => {
		const svc = make({ stallMin: 0 })
		feed = [msg('s1')]
		script = [() => new Promise<Reply>(() => {})]
		svc.runNow('s1')
		await advance(24 * 60 * MIN)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.equal(jobs(svc)[0]?.attempts, 0)
		assert.deepEqual(cancelled, [])
	})

	it('сторож: остановленное пользователем зависшее задание завершается done, а не повторяется', async () => {
		const svc = make({ stallMin: 5 })
		feed = [msg('s1')]
		script = [() => new Promise<Reply>(() => {})]
		const j = svc.runNow('s1')
		svc.cancelJob(j.id)
		await advance(10 * MIN)
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(jobs(svc)[0]?.attempts, 0)
	})

	it('замок: второе задание того же кейса остаётся queued, пока первое идёт (отдельного состояния нет)', () => {
		const svc = make()
		feed = [msg('s1')]
		script = [() => new Promise<Reply>(() => {})]
		svc.runNow('s1')
		const second = svc.runNow('s1')
		assert.equal(second.status, 'queued')
		assert.equal('waiting' in second, false)
		assert.equal('retryAt' in second, false)
	})
})
