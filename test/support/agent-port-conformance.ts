/**
 * Абстрактный conformance-сьют AgentPort (§10 дизайна): общий для всех адаптеров. Сьют требует события,
 * но не их нативного происхождения — адаптер вправе синтезировать их из собственных действий (§3).
 *
 * Использование: каждый тест адаптера создаёт свежий порт через `makePort()` и вызывает этот сьют.
 * Сценарии: создать сессию → session.ready → промпт → turn.started → message.delta → message.completed →
 * turn.completed → отмена → turn.cancelled → закрытие → session.closed. Модель-смена проверяется по capability.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentPort, Envelope } from '../../src/application/agent-port'

export interface ConformanceOptions {
	/** свежий порт на каждый сценарий */
	makePort: () => Promise<AgentPort>
	/** воркспейс для создания сессий */
	cwd: string
	/** префикс имён тестов (для различения адаптеров в одном прогоне) */
	label: string
	/** промпт, который держит ход открытым до отмены (для теста promptCancel) */
	slowPrompt?: string
	/** промпт, который порождает permission.requested и держит ход открытым до голоса; если не задан — кейс permission пропускается */
	permissionPrompt?: string
	/** таймаут ожидания событий, мс */
	waitMs?: number
}

const DEFAULT_WAIT_MS = 2000

/** Коллектор событий подписки с ожиданием по предикату. */
class Collector {
	private readonly events: Envelope[] = []
	private readonly waiters: { pred: (e: Envelope) => boolean; resolve: (e: Envelope) => void; timer: NodeJS.Timeout }[] = []

	push(e: Envelope): void {
		this.events.push(e)
		for (let i = 0; i < this.waiters.length; i++) {
			const w = this.waiters[i]!
			if (w.pred(e)) {
				clearTimeout(w.timer)
				this.waiters.splice(i, 1)
				w.resolve(e)
				return
			}
		}
	}

	/** Дождаться события, удовлетворяющего предикату; throw при таймауте. */
	waitFor(pred: (e: Envelope) => boolean, label: string, ms: number): Promise<Envelope> {
		const hit = this.events.find(pred)
		if (hit) return Promise.resolve(hit)
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`[conformance] не дождались «${label}» за ${ms} мс; получено: ${this.events.map(e => e.type).join(', ') || 'ничего'}`)), ms)
			timer.unref()
			this.waiters.push({ pred, resolve, timer })
		})
	}

	all(): Envelope[] {
		return this.events
	}
}

function ofType(c: Collector, type: string): Promise<Envelope> {
	return c.waitFor(e => e.type === type, type, DEFAULT_WAIT_MS)
}

export function runAgentPortConformance(opts: ConformanceOptions): void {
	const { makePort, cwd, label, slowPrompt = '#slow', permissionPrompt, waitMs = DEFAULT_WAIT_MS } = opts
	const p = (name: string): string => `${label}: ${name}`

	test(p('создание сессии и session.ready'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		assert.ok(sessionId, 'sessionCreate вернул пустой sessionId')
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		const ready = await c.waitFor(e => e.type === 'session.ready', 'session.ready', waitMs)
		assert.equal(ready.type, 'session.ready')
		assert.equal(ready.v, 1)
		assert.ok(typeof ready.ts === 'number')
	})

	test(p('промпт: turn.started → message.delta → message.completed → turn.completed'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, 'тест')
		await ofType(c, 'turn.started')
		if (port.capabilities.streamText) {
			const delta = await ofType(c, 'message.delta')
			assert.ok(typeof delta.data === 'object' && delta.data !== null && typeof (delta.data as { text?: string }).text === 'string')
			await ofType(c, 'message.completed')
		}
		const completed = await ofType(c, 'turn.completed')
		assert.equal(completed.type, 'turn.completed')
	})

	test(p('отмена хода → turn.cancelled'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, slowPrompt)
		await ofType(c, 'turn.started')
		await port.promptCancel(sessionId)
		await ofType(c, 'turn.cancelled')
	})

	test(p('ошибка хода → turn.failed с retryable'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, '#error')
		const failed = await ofType(c, 'turn.failed')
		const data = failed.data as { retryable: boolean; message: string }
		assert.equal(typeof data.retryable, 'boolean')
		assert.ok(data.message.length > 0)
	})

	test(p('закрытие сессии → session.closed'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.sessionClose(sessionId)
		await ofType(c, 'session.closed')
	})

	test(p('session.resume возвращает контрактный результат и поднятая сессия снова готова'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await ofType(c, 'session.ready')
		const r = await port.sessionResume(sessionId, cwd)
		// контракт: null (сессии нет) либо { lastSeq: number | null }
		if (r === null) return
		assert.ok(r.lastSeq === null || typeof r.lastSeq === 'number')
		const c2 = new Collector()
		port.subscribe(sessionId, { onEvent: e => c2.push(e) })
		await ofType(c2, 'session.ready')
	})

	test(p('permission.vote: request → голос → permission.resolved'), async () => {
		const port = await makePort()
		if (!permissionPrompt || !port.capabilities.permissionVote) return // кейс недоступен адаптеру — пропускаем
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, permissionPrompt)
		const req = await ofType(c, 'permission.requested')
		const requestId = (req.data as { requestId: string }).requestId
		assert.ok(requestId.length > 0)
		await port.permissionVote(sessionId, requestId, 'allow')
		await ofType(c, 'permission.resolved')
	})

	test(p('model.set по capability'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		if (port.capabilities.setModel) {
			await port.modelSet(sessionId, 'fake/model')
			await ofType(c, 'model.switched')
		} else {
			await assert.rejects(() => port.modelSet(sessionId, 'fake/model'))
		}
	})

	test(p('capabilities — четыре флага'), async () => {
		const port = await makePort()
		const caps = port.capabilities
		for (const key of ['streamText', 'midTurn', 'permissionVote', 'setModel'] as const) assert.equal(typeof caps[key], 'boolean')
	})

	test(p('все конверты валидны, seq монотонен и уникален (v, seq, ts, type)'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, 'валидность')
		await ofType(c, 'turn.completed')
		await new Promise(r => setTimeout(r, 10))
		const all = c.all()
		assert.ok(all.length > 0, 'должны быть получены события')
		let prev = -Infinity
		for (const e of all) {
			assert.equal(e.v, 1)
			assert.ok(typeof e.type === 'string' && e.type.length > 0)
			assert.equal(typeof e.seq, 'number', `${e.type}: seq должен быть числом`)
			const seq = e.seq as number
			assert.ok(Number.isInteger(seq), `${e.type}: seq должен быть целым`)
			assert.ok(seq > prev, `${e.type}: seq должен быть строго монотонным и уникальным (получено ${seq}, предыдущий ${prev})`)
			prev = seq
			assert.ok(typeof e.ts === 'number')
		}
	})

	test(p('mid_turn.send → boolean; при true — mid_turn.injected'), async () => {
		const port = await makePort()
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		if (port.capabilities.midTurn) {
			const ok = await port.midTurnSend(sessionId, 'доп.сообщение')
			assert.equal(typeof ok, 'boolean')
			if (ok) await ofType(c, 'mid_turn.injected')
		} else {
			await assert.rejects(() => port.midTurnSend(sessionId, 'доп.сообщение'))
		}
	})
}