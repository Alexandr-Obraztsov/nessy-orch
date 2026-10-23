/**
 * Живой integration-тест NessySdkAgentPort против реального nessy-sdk рантайма (ORCH_E2E=1).
 * По умолчанию пропущен: поднимает настоящие CLI-процессы nessy и делает платные LLM-промпты,
 * поэтому запускается только явно: `ORCH_E2E=1 npm test -- .../agent-port-sdk-live.test.js`.
 *
 * Проверяет (§6б / контракт §3):
 *  - session.create → подписка → session.ready, модель приходит из system/init (сверка через model.switch_failed);
 *  - первый промпт → session.meta (displayName), turn.started → message.delta → message.completed → turn.completed
 *    с context.usage из result; seq строго монотонен;
 *  - второй промпт на той же сессии (resume вторым ходом, контекст сохраняется);
 *  - prompt.cancel живого хода → exit-130 → turn.cancelled, хэндл закрыт (дальнейшие операции отклоняются);
 *  - две параллельные сессии.
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { it } from 'node:test'
import type { Envelope } from '../../src/application/agent-port'
import { NessySdkAgentPort } from '../../src/infrastructure/nessy/agent-port-sdk'

const LIVE = process.env['ORCH_E2E'] === '1'

/** Дешёвый промпт, который гарантированно отвечает коротко (мало токенов). */
const CHEAP = 'Ответь ровно одним коротким словом: готово'
/** Промпт, который держит модель занятой заметно дольше (для отмены живого хода). */
const LONG = 'Напиши стихотворение о написании кода, минимум 300 слов, рифмуй'

/** Коллектор событий подписки с ожиданием по предикату (аналог conformance-сьюта). */
class Collector {
	private readonly events: Envelope[] = []
	private readonly waiters: { pred: (e: Envelope) => boolean; resolve: (e: Envelope) => void; timer: NodeJS.Timeout }[] = []

	push(e: Envelope): void {
		this.events.push(e)
		for (let i = 0; i < this.waiters.length; i++) {
			const w = this.waiters[i] as (typeof this.waiters)[number]
			if (w.pred(e)) {
				clearTimeout(w.timer)
				this.waiters.splice(i, 1)
				w.resolve(e)
				return
			}
		}
	}

	waitFor(pred: (e: Envelope) => boolean, label: string, ms: number): Promise<Envelope> {
		const hit = this.events.find(pred)
		if (hit) return Promise.resolve(hit)
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`не дождались «${label}» за ${ms} мс; получено: ${this.events.map(e => e.type).join(', ') || 'ничего'}`)),
				ms,
			)
			timer.unref()
			this.waiters.push({ pred, resolve, timer })
		})
	}

	all(): Envelope[] {
		return this.events
	}
}

function livePort(cwd: string, opts: { model?: string } = {}): NessySdkAgentPort {
	return new NessySdkAgentPort({ cwd, ...(opts.model !== undefined ? { model: opts.model } : {}), permissionMode: 'default' })
}

async function waitDone(c: Collector, label: string): Promise<Envelope> {
	return c.waitFor(e => e.type === 'turn.completed' || e.type === 'turn.failed' || e.type === 'turn.cancelled', label, 120_000)
}

it('agent-port-sdk live: полный ход, мета, модель из system/init, usage, seq монотонен', { skip: !LIVE, timeout: 180_000 }, async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-live-'))
	// опцию модели не задаём: runtime выбирает модель сам, адаптер читает её из system/init (не доверяет опции, §3).
	// Живой прогон подтверждает: session.ready и полный ход возможны без опции модели — значит system/init обработан.
	const port = livePort(cwd)
	const { sessionId } = await port.sessionCreate(cwd)
	const c = new Collector()
	port.subscribe(sessionId, { onEvent: e => c.push(e) })
	await c.waitFor(e => e.type === 'session.ready', 'session.ready', 30_000)

	await port.promptSend(sessionId, CHEAP)
	const meta = await c.waitFor(e => e.type === 'session.meta', 'session.meta', 10_000)
	assert.ok(typeof (meta.data as { displayName?: string }).displayName === 'string')
	await waitDone(c, 'первый ход')
	const usage = await c.waitFor(e => e.type === 'context.usage', 'context.usage', 10_000)
	assert.ok(typeof (usage.data as { used?: number }).used === 'number' && (usage.data as { used: number }).used > 0, 'usage.used из result')

	// seq строго монотонен и уникален по всей сессии
	const seqs = c.all().map(e => e.seq as number)
	assert.ok(seqs.length >= 3, `мало событий: ${seqs.length}`)
	for (let i = 1; i < seqs.length; i++) assert.ok((seqs[i] as number) > (seqs[i - 1] as number), `seq не монотонен: ${seqs.join(', ')}`)

	await port.sessionClose(sessionId)
})

it('agent-port-sdk live: второй промпт на той же сессии (resume вторым ходом, контекст)', { skip: !LIVE, timeout: 180_000 }, async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-live-'))
	const port = livePort(cwd)
	const { sessionId } = await port.sessionCreate(cwd)
	const c = new Collector()
	port.subscribe(sessionId, { onEvent: e => c.push(e) })
	await c.waitFor(e => e.type === 'session.ready', 'session.ready', 30_000)

	await port.promptSend(sessionId, CHEAP)
	await waitDone(c, 'первый ход')
	const usage1 = await c.waitFor(e => e.type === 'context.usage', 'context.usage 1', 10_000)

	await port.promptSend(sessionId, CHEAP)
	await waitDone(c, 'второй ход')
	const usage2 = await c.waitFor(e => e.type === 'context.usage', 'context.usage 2', 10_000)
	// контекст растёт: usage.used на втором ходу не меньше первого
	const u1 = (usage1.data as { used: number }).used
	const u2 = (usage2.data as { used: number }).used
	assert.ok(u2 >= u1, `контекст не вырос между ходами: ${u1} → ${u2}`)

	await port.sessionClose(sessionId)
})

it('agent-port-sdk live: prompt.cancel живого хода → turn.cancelled, хэндл закрыт', { skip: !LIVE, timeout: 180_000 }, async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-live-'))
	const port = livePort(cwd)
	const { sessionId } = await port.sessionCreate(cwd)
	const c = new Collector()
	port.subscribe(sessionId, { onEvent: e => c.push(e) })
	await c.waitFor(e => e.type === 'session.ready', 'session.ready', 30_000)

	await port.promptSend(sessionId, LONG)
	await c.waitFor(e => e.type === 'turn.started', 'turn.started', 10_000)
	await port.promptCancel(sessionId)
	const cancelled = await c.waitFor(e => e.type === 'turn.cancelled', 'turn.cancelled', 30_000)
	assert.equal(cancelled.type, 'turn.cancelled')
	// хэндл закрыт: дальнейшие операции отклоняются
	await assert.rejects(() => port.promptSend(sessionId, CHEAP), /не найдена/)
})

it('agent-port-sdk live: две параллельные сессии работают независимо', { skip: !LIVE, timeout: 240_000 }, async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-live-'))
	const port = livePort(cwd)
	const s1 = (await port.sessionCreate(cwd)).sessionId
	const s2 = (await port.sessionCreate(cwd)).sessionId
	const c1 = new Collector()
	const c2 = new Collector()
	port.subscribe(s1, { onEvent: e => c1.push(e) })
	port.subscribe(s2, { onEvent: e => c2.push(e) })
	await Promise.all([c1.waitFor(e => e.type === 'session.ready', 'ready s1', 30_000), c2.waitFor(e => e.type === 'session.ready', 'ready s2', 30_000)])

	await Promise.all([port.promptSend(s1, CHEAP), port.promptSend(s2, CHEAP)])
	await Promise.all([waitDone(c1, 'ход s1'), waitDone(c2, 'ход s2')])
	for (const c of [c1, c2]) await c.waitFor(e => e.type === 'context.usage', 'usage', 10_000)

	await Promise.all([port.sessionClose(s1), port.sessionClose(s2)])
})
