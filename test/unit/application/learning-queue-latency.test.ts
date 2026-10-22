/** Задержки очереди обучения: мгновенный запуск, реакция на шину, пауза повтора 5 с, сторожевой таймер, состояния ожидания. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { COOLDOWN_MS, JOB_STALL_MS, TICK_DEBOUNCE_MS } from '../../../src/domain/learning-settings'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { stubCollect } from '../../support/stub-collect'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[]}</meta>'

const flush = async (): Promise<void> => {
	for (let i = 0; i < 6; i++) await new Promise<void>(r => setImmediate(r))
}

type Reply = { ok: boolean; text: string; error?: string }

describe('очередь обучения: задержки', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let sessions: SessionView[]
	let feed: Message[]
	let seq: number
	/** ответы агентов по порядку вызовов; функция — управляемый ответ */
	let script: Array<Reply | (() => Promise<Reply>)>
	let calls: number
	let cancelled: string[]
	const clock = { now: (): number => Date.now() }

	const session = (id: string): SessionView => ({ id, title: id, owner: null, status: 'active', summary: null, createdAt: new Date(T0 + 60_000).toISOString(), updatedAt: new Date(T0).toISOString(), sources: 0, chatId: `chat-${id}` })
	const msg = (s: string): Message => ({ seq: ++seq, id: `m${seq}`, ts: Date.now(), from: YOU, to: 'a1', kind: 'msg', text: `t${seq}`, hops: 0, session: s })
	/** новое сообщение: в ленте и на шине (как `Feed.append`) */
	const emit = (s: string): void => {
		const m = msg(s)
		feed.push(m)
		hub.publish({ t: 'message', message: m })
	}
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
		runAgent: async req => {
			calls += 1
			const id = `ag${calls}`
			req.onSpawn?.(id)
			const step = script.shift() ?? { ok: true, text: GOOD }
			const r = typeof step === 'function' ? await step() : step
			return { agentId: id, ...r }
		},
	}
	const make = (tickMs = 0): LearningService => {
		const s = new LearningService({ store, host, hub, clock, ids: { next: () => Math.random().toString(36).slice(2, 10) }, defaultOn: true, tickMs, claudeProjectsDir: '/p' })
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

	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 + 60_000 })
		seq = 0
		calls = 0
		cancelled = []
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

	it('свободный слот: задание running синхронно из runNow, без тика и ожидания', () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		script = [() => new Promise(() => {})]
		const j = svc.runNow('s1')
		assert.equal(j.status, 'running')
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.equal(calls, 1)
	})

	it('шина: новое сообщение даёт кейс через окно TICK_DEBOUNCE_MS, сбор — после паузы COOLDOWN_MS, опроса нет', async () => {
		const svc = make(30_000)
		svc.start()
		emit('s1')
		await advance(TICK_DEBOUNCE_MS - 1)
		assert.equal(svc.view().cases.length, 0)
		await advance(1)
		assert.equal(svc.view().cases.length, 1)
		assert.equal(jobs(svc).length, 0)
		// всплеск событий сводится в один тик, сбор ждёт конца паузы кейса (она отсчитывается от его заведения)
		script = [() => new Promise(() => {})]
		emit('s1')
		await advance(COOLDOWN_MS - 1)
		assert.equal(jobs(svc).length, 0)
		await advance(1)
		assert.equal(jobs(svc).length, 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.ok(Date.now() - (T0 + 60_000) < 30_000) // раньше первого тика опроса
		const stopped = svc.stop() // агент висит: stop ждёт его не дольше 5 с
		mock.timers.tick(5_000)
		await stopped
	})

	it('без новых сообщений кейс с необработанными событиями собирается по таймеру конца паузы, а не по опросу', async () => {
		const svc = make(10 * 60_000)
		svc.start()
		emit('s1')
		await advance(TICK_DEBOUNCE_MS)
		assert.equal(svc.view().cases[0]?.events, 1)
		await advance(COOLDOWN_MS)
		assert.equal(jobs(svc).length, 1)
		assert.equal(calls, 1)
		await svc.stop()
	})

	it('провал: повтор через 5 с (потом 10, 20 …), без тика — будит таймер', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		script = [{ ok: false, text: '', error: 'сбой' }, { ok: false, text: '', error: 'сбой' }]
		svc.runNow('s1')
		await flush()
		assert.equal(calls, 1)
		const j = jobs(svc)[0]
		assert.equal(j?.status, 'queued')
		assert.equal(j.waiting, 'retry')
		assert.equal(j.retryAt, new Date(Date.now() + 5_000).toISOString())
		await advance(4_999)
		assert.equal(calls, 1)
		await advance(1)
		assert.equal(calls, 2)
		assert.equal(jobs(svc)[0]?.attempts, 2)
		// вторая пауза — 10 с
		assert.equal(jobs(svc)[0]?.retryAt, new Date(Date.now() + 10_000).toISOString())
		await advance(9_999)
		assert.equal(calls, 2)
		await advance(1)
		assert.equal(calls, 3)
		assert.equal(jobs(svc)[0]?.status, 'done')
	})

	it('слот освободился — следующее задание стартует сразу, без тика', async () => {
		const svc = make()
		store.settingsRaw = { maxAgents: 1 }
		store.mtimeMs += 1
		feed = [msg('s1'), msg('s2')]
		svc.tick()
		let release = (): void => {}
		script = [() => new Promise<Reply>(r => (release = () => r({ ok: true, text: GOOD })))]
		svc.runNow('s1')
		svc.runNow('s2')
		assert.deepEqual(jobs(svc).map(j => [j.status, j.waiting]), [['running', null], ['queued', null]])
		release()
		await flush()
		assert.equal(calls, 2)
		assert.deepEqual(jobs(svc).map(j => j.status), ['done', 'done'])
	})

	it('сторож: без активности JOB_STALL_MS агент снят, задание queued (попытка 1), слот свободен, поздний итог игнорируется', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s2')]
		svc.tick()
		store.settingsRaw = { maxAgents: 1 }
		store.mtimeMs += 1
		svc.tick()
		let late = (): void => {}
		script = [() => new Promise<Reply>(r => (late = () => r({ ok: true, text: GOOD }))), () => new Promise<Reply>(() => {})]
		svc.runNow('s1')
		svc.runNow('s2') // ждёт слот
		await advance(JOB_STALL_MS - 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		await advance(1)
		const first = jobs(svc)[0]
		assert.deepEqual(cancelled, ['ag1'])
		assert.equal(first?.status, 'queued')
		assert.equal(first.attempts, 1)
		assert.match(first.error ?? '', /нет активности/)
		// слот освободился: второе задание пошло сразу
		assert.equal(jobs(svc)[1]?.status, 'running')
		// поздний ответ снятого агента ничего не меняет
		const covered = svc.getCase('c-s1').coveredUntil
		late()
		await flush()
		assert.equal(jobs(svc)[0]?.attempts, 1)
		assert.equal(svc.getCase('c-s1').coveredUntil, covered)
		assert.notEqual(store.summaries.get('c-s1'), '# T')
	})

	it('сторож: touchJob продлевает срок', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		script = [() => new Promise<Reply>(() => {})]
		svc.runNow('s1')
		await advance(JOB_STALL_MS - 1_000)
		svc.touchJob('c-s1')
		await advance(JOB_STALL_MS - 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.deepEqual(cancelled, [])
		await advance(1)
		assert.equal(jobs(svc)[0]?.status, 'queued')
		assert.deepEqual(cancelled, ['ag1'])
	})

	it('сторож: остановленное пользователем зависшее задание завершается done, а не повторяется', async () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		script = [() => new Promise<Reply>(() => {})]
		const j = svc.runNow('s1')
		svc.cancelJob(j.id)
		await advance(JOB_STALL_MS)
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(jobs(svc)[0]?.attempts, 0)
	})

	it('waiting: retry — пауза повтора, lock — идущее задание того же объекта; готовое без слота — null', () => {
		const svc = make()
		feed = [msg('s1')]
		svc.tick()
		script = [() => new Promise<Reply>(() => {})]
		svc.runNow('s1')
		// второй close того же кейса при идущем: замок
		const second = svc.runNow('s1')
		assert.equal(second.status, 'queued')
		assert.equal(second.waiting, 'lock')
		assert.equal(second.retryAt, null)
	})
})
