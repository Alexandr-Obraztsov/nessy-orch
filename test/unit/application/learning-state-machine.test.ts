/**
 * Симулятор очереди и состояний обучения: детерминированная (seed) последовательность из 300 операций над 5 сессиями,
 * после каждой — инварианты. Часы и таймеры фейковые (`mock.timers`), агенты управляются тестом.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { JobView, Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { COOLDOWN_MS } from '../../../src/domain/learning-settings'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { stubCollect } from '../../support/stub-collect'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const SESSIONS = 5
const OPS = 300
const SEEDS = [1, 2, 3, 7, 11, 42, 2026, 31337]

/** mulberry32: маленький детерминированный генератор */
function rng(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 6; i++) await new Promise<void>(r => setImmediate(r))
}

type Reply = { agentId: string; ok: boolean; text: string; error?: string }

describe('машина состояний обучения: симулятор', () => {
	let store: MemoryLearningStore
	let sessions: SessionView[]
	let feed: Message[]
	let seq: number
	let agentSeq: number
	/** идущие агенты текущего запуска сервиса: id → завершение */
	let pending: Map<string, (r: Reply) => void>
	const clock = { now: (): number => Date.now() }

	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: id => {
			// как настоящий: ход прерван — runAgent возвращается с ошибкой
			pending.get(id)?.({ agentId: id, ok: false, text: '', error: 'отменён' })
			pending.delete(id)
			return Promise.resolve()
		},
		runAgent: req =>
			new Promise<Reply>(resolve => {
				agentSeq += 1
				const id = `ag${agentSeq}`
				pending.set(id, r => resolve(r))
				req.onSpawn?.(id)
			}),
	}

	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: T0 + 60_000 })
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', 'x')
		seq = 0
		agentSeq = 0
		feed = []
		pending = new Map()
		sessions = Array.from({ length: SESSIONS }, (_, i) => ({
			id: `s${i}`, title: `s${i}`, owner: null, status: 'active', summary: null,
			createdAt: new Date(T0 + 60_000).toISOString(), updatedAt: new Date(T0).toISOString(), sources: 0, chatId: `chat-s${i}`,
		}))
	})
	afterEach(() => {
		mock.timers.reset()
	})

	const boot = (): LearningService => {
		const svc = new LearningService({ store, host, hub: new Hub(), clock, ids: { next: () => Math.random().toString(36).slice(2, 10) }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p' })
		svc.registerHandler(stubCollect)
		svc.load()
		svc.start()
		return svc
	}

	/** Инварианты; `maxBefore` — число running до операции (понижение maxAgents не убивает идущих). */
	const check = (svc: LearningService, where: string, prevRunning: number): void => {
		const now = Date.now()
		const view = svc.view()
		const max = svc.getSettings().maxAgents
		const jobs = view.jobs
		const running = jobs.filter(j => j.status === 'running')
		const queued = jobs.filter(j => j.status === 'queued')
		const fail = (msg: string): never => assert.fail(`${where}: ${msg}\n${JSON.stringify(jobs.filter(j => j.status !== 'done').map(j => [j.id, j.kind, j.subject, j.status, j.waiting, j.retryAt]))}`)
		// состояния только queued → running → done
		for (const j of jobs) if (j.status !== 'queued' && j.status !== 'running' && j.status !== 'done') fail(`состояние ${j.status}`)
		// (а) идущих не больше maxAgents (после понижения настройки — не больше, чем было)
		if (running.length > max && running.length > prevRunning) fail(`running ${running.length} > maxAgents ${max}`)
		// (б) на объект не больше одного идущего и одного ждущего задания
		for (const kind of ['running', 'queued'] as const) {
			const seen = new Set<string>()
			for (const j of jobs.filter(x => x.status === kind)) {
				if (seen.has(j.subject)) fail(`два ${kind} у ${j.subject}`)
				seen.add(j.subject)
			}
		}
		// (в) есть свободный слот — среди queued нет готового к запуску
		const isReady = (j: JobView): boolean => (j.retryAt === null || Date.parse(j.retryAt) <= now) && !running.some(r => r.subject === j.subject)
		if (running.length < max) {
			const stuck = queued.filter(isReady)
			if (stuck.length) fail(`свободный слот (${running.length}/${max}), но готово к запуску: ${stuck.map(j => j.id).join()}`)
		}
		// ожидание описано честно: retry — пауза впереди, lock — идущее задание того же объекта, иначе null
		for (const j of queued) {
			const want = j.retryAt !== null && Date.parse(j.retryAt) > now ? 'retry' : running.some(r => r.subject === j.subject) ? 'lock' : null
			if (j.waiting !== want) fail(`waiting ${j.id}: ${j.waiting}, ожидалось ${want}`)
		}
		// (г) идущее задание всегда с живым агентом, живой агент — всегда у идущего задания
		const agents = new Set(running.map(j => j.agentId))
		for (const j of running) if (j.agentId === null || !pending.has(j.agentId)) fail(`running ${j.id} без агента (${j.agentId})`)
		for (const id of pending.keys()) if (!agents.has(id)) fail(`агент ${id} без идущего задания`)
		for (const c of view.cases) {
			// (е)
			if (c.coveredUntil > c.events) fail(`coveredUntil ${c.coveredUntil} > events ${c.events} у ${c.id}`)
			const active = jobs.some(j => j.caseId === c.id && (j.status === 'queued' || j.status === 'running'))
			// (д) собирающийся кейс с необработанными событиями без задания — только на паузе сбора
			if (c.status === 'collecting' && c.events > c.coveredUntil && !active) {
				const st = store.cases.get(c.id)
				if (!st || now - st.lastRunAt >= COOLDOWN_MS) fail(`кейс ${c.id}: ${c.events - c.coveredUntil} необработанных, задания нет, пауза прошла`)
			}
			// closing без задания закрытия — застрявший кейс
			if (c.status === 'closing' && !active) fail(`кейс ${c.id} в closing без задания`)
		}
	}

	for (const seed of SEEDS) {
		it(`seed ${seed}: ${OPS} операций, инварианты после каждой, затем всё доходит до ready`, async () => {
			const rnd = rng(seed)
			const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
			let svc = boot()
			const step = async (name: string, prevRunning: number, fn: () => void | Promise<void>): Promise<void> => {
				try {
					await fn()
				} catch (e) {
					if (!(e instanceof Error) || !/нет кейса|no_case|не найден|no_job/.test(e.message)) throw e
				}
				svc.tick()
				await flush()
				// конец задания зовёт отложенный tick (`requestTick`); при `tickMs: 0` его заменяет второй вызов
				svc.tick()
				await flush()
				check(svc, `seed ${seed} ${name}`, prevRunning)
			}
			for (let i = 0; i < OPS; i++) {
				const prev = svc.view().jobs.filter(j => j.status === 'running').length
				const r = rnd()
				const s = pick(sessions)
				if (r < 0.3) {
					await step(`#${i} event ${s.id}`, prev, () => {
						seq += 1
						feed.push({ seq, id: `m${seq}`, ts: Date.now(), from: YOU, to: 'a1', kind: 'msg', text: `t${seq}`, hops: 0, session: s.id })
						s.updatedAt = new Date(Date.now()).toISOString()
					})
				} else if (r < 0.5) {
					const ms = pick([500, 2_000, 5_000, 21_000, 61_000, 130_000, 11 * 60_000, 31 * 60_000])
					await step(`#${i} advance ${ms}`, prev, () => {
						mock.timers.tick(ms)
					})
				} else if (r < 0.62 && pending.size) {
					const id = pick([...pending.keys()])
					await step(`#${i} finish ${id}`, prev, () => {
						pending.get(id)?.({ agentId: id, ok: true, text: 'ok' })
						pending.delete(id)
					})
				} else if (r < 0.68 && pending.size) {
					const id = pick([...pending.keys()])
					await step(`#${i} fail ${id}`, prev, () => {
						pending.get(id)?.({ agentId: id, ok: false, text: '', error: 'сбой' })
						pending.delete(id)
					})
				} else if (r < 0.74) {
					await step(`#${i} close ${s.id}`, prev, () => svc.onSessionClosed(s.id))
				} else if (r < 0.8) {
					await step(`#${i} runNow ${s.id}`, prev, () => void svc.runNow(s.id))
				} else if (r < 0.85) {
					const active = svc.view().jobs.filter(j => j.status !== 'done')
					if (active.length) {
						const j = pick(active)
						await step(`#${i} cancel ${j.id}`, prev, () => void svc.cancelJob(j.id))
					}
				} else if (r < 0.89) {
					await step(`#${i} restart`, prev, async () => {
						const stopped = svc.stop()
						mock.timers.tick(5_000)
						await stopped
						// агенты прежнего запуска остались сиротами: у нового сервиса своих нет
						pending = new Map()
						svc = boot()
					})
				} else {
					const n = 1 + Math.floor(rnd() * 4)
					await step(`#${i} maxAgents ${n}`, prev, () => void svc.updateSettings({ maxAgents: n }))
				}
			}
			// живость: отказов больше нет, агенты отвечают — всё доходит до ready, очередь пуста
			for (let round = 0; round < 80; round++) {
				const prev = svc.view().jobs.filter(j => j.status === 'running').length
				await step(`drain ${round}`, prev, () => {
					for (const [id, done] of [...pending]) {
						done({ agentId: id, ok: true, text: 'ok' })
						pending.delete(id)
					}
					mock.timers.tick(130_000)
				})
				const v = svc.view()
				if (v.jobs.every(j => j.status === 'done') && v.cases.every(c => c.status === 'ready')) break
			}
			const v = svc.view()
			assert.deepEqual(v.jobs.filter(j => j.status !== 'done').map(j => [j.id, j.status]), [], `seed ${seed}: очередь не опустела`)
			assert.deepEqual(v.cases.filter(c => c.status !== 'ready').map(c => [c.id, c.status]), [], `seed ${seed}: кейсы не дошли до ready`)
			const stopped = svc.stop()
			mock.timers.tick(5_000)
			await stopped
		})
	}
})
