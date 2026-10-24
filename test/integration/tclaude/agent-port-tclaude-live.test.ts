/**
 * Живые tclaude-тесты (ORCH_E2E_TCLAUDE=1; по умолчанию не регистрируются — skip).
 * МАКСИМАЛЬНО дешёвые: модель по умолчанию (НЕ sonnet), промпты «ответь словом ok», суммарно ≤4 запуска tclaude:
 *  1) session.create → prompt → события (верификация модели из init, ТЕКСТ ответа, seq, usage/cost) → result;
 *  2) второй ход на той же сессии: процесс -p умер после result, promptSend переподнимает с --resume — ТЕКСТ есть;
 *  3) cancel живого хода (SIGINT → turn.cancelled, поздний result игнорируется).
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import type { Envelope } from '../../../src/application/agent-port'
import { TclaudeAgentPort } from '../../../src/infrastructure/tclaude/agent-port-tclaude'
import { defaultResolveAuth } from '../../../src/infrastructure/tclaude/spawn-claude'
import { TclaudeSpace } from '../../../src/infrastructure/process/tclaude-space'
import { FakeAgentPort } from '../../support/fake-agent-port'
import { startHarness } from '../../support/harness'
import { FakeSpace } from '../../support/memory-store'

const E2E = process.env.ORCH_E2E_TCLAUDE === '1'

if (E2E) {
	// auth llm-прокси резолвится адаптером (из env либо из apiKeyHelper реального ~/.claude/settings.json); без неё tclaude не стартует
	if (!defaultResolveAuth().token) {
		throw new Error('ORCH_E2E_TCLAUDE=1, но auth llm-прокси недоступен: нет ANTHROPIC_AUTH_TOKEN в env и нет apiKeyHelper/токена в ~/.claude/settings.json')
	}
	/** Модель по умолчанию: из env, иначе — дефолт рантайма tclaude (без --model). */
	const model = process.env['ORCH_E2E_TCLAUDE_MODEL'] || undefined
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tclaude-live-'))
	const WAIT_MS = 180_000

	/** Сборщик событий порта с ожиданием по предикату. */
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
				// таймер держит event loop: если tclaude ушёл (не ответил), дождёмся явного таймаута, а не «event loop resolved»
				this.waiters.push({ pred, resolve, timer })
			})
		}

		all(): Envelope[] {
			return this.events
		}
	}

	/** Собрать текст из message.completed (итоговые ответы модели). */
	function replyTexts(c: Collector): string[] {
		return c
			.all()
			.filter(e => e.type === 'message.completed')
			.map(e => (e.data as { text?: string }).text ?? '')
	}

	test('живой ход: create→prompt→события→result; верификация модели из init; ТЕКСТ ответа; usage/cost', async () => {
		const port = new TclaudeAgentPort({ model: model ?? null })
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, 'ответь ровно одним словом: ok')
		await c.waitFor(e => e.type === 'turn.started', 'turn.started', 30_000)
		await c.waitFor(e => e.type === 'turn.completed', 'turn.completed', WAIT_MS)
		// верификация модели из system/init: tclaude обязан сообщить фактическую модель
		const actual = port.sessionModel(sessionId)
		assert.ok(actual && actual.trim().length > 0, `модель из system/init пуста: ${String(actual)}`)
		// ТЕКСТ ответа не должен быть пустым (регрессия потери текста)
		const reply = replyTexts(c).at(-1) ?? ''
		assert.ok(
			reply.trim().length > 0,
			`ответ пуст: события ${c
				.all()
				.map(e => e.type)
				.join(', ')}`,
		)
		// usage/cost из result
		const usage = port.sessionUsage(sessionId)
		assert.ok(usage, 'ожидали UnifiedUsage')
		assert.ok(usage.totalTokens === null || usage.totalTokens > 0, `totalTokens должен быть > 0 или null: ${usage.totalTokens}`)
		assert.ok(usage.costUsd === null || usage.costUsd >= 0, `costUsd отрицательный: ${usage.costUsd}`)
		// seq монотонен и уникален
		let prev = -Infinity
		for (const e of c.all()) {
			const seq = e.seq
			assert.ok(Number.isInteger(seq) && seq > prev, `seq не монотонен: ${e.type}=${seq}`)
			prev = seq
		}
		await port.sessionClose(sessionId)
	})

	test('второй ход на той же сессии: после result процесс -p умер, promptSend переподнял с --resume — ТЕКСТ есть', async () => {
		const port = new TclaudeAgentPort({ model: model ?? null })
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, 'запомни одно слово: банан')
		await c.waitFor(e => e.type === 'turn.completed', 'первый ход', WAIT_MS)
		// второй промпт на той же сессии: -p-процесс умер, адаптер переподнимает с --resume (контекст сохраняется)
		await port.promptSend(sessionId, 'какое слово ты запомнил? ответь ровно одним словом')
		await c.waitFor(e => e.type === 'turn.completed', 'второй ход', WAIT_MS)
		const texts = replyTexts(c)
		assert.ok(texts.length >= 2, `ожидали два ответа, получили: ${texts.join(' | ')}`)
		const second = texts.at(-1) ?? ''
		assert.ok(second.trim().length > 0, 'второй ход вернул пустой ответ')
		assert.match(second, /банан|banana/i, `второй ход не подтвердил контекст: «${second}»`)
		await port.sessionClose(sessionId)
	})

	test('cancel живого хода: SIGINT → turn.cancelled, поздний result игнорируется', async () => {
		const port = new TclaudeAgentPort({ model: model ?? null })
		const { sessionId } = await port.sessionCreate(cwd)
		const c = new Collector()
		port.subscribe(sessionId, { onEvent: e => c.push(e) })
		await port.promptSend(sessionId, 'напиши очень длинный текст про фламинго, абзац за абзацем')
		await c.waitFor(e => e.type === 'turn.started', 'turn.started', 60_000)
		await port.promptCancel(sessionId)
		await c.waitFor(e => e.type === 'turn.cancelled', 'turn.cancelled', 30_000)
		// небольшое окно: поздний result после отмены не должен дать turn.completed
		await new Promise(r => setTimeout(r, 1500))
		assert.ok(!c.all().some(e => e.type === 'turn.completed'), 'после отмены не должно быть turn.completed')
		await port.sessionClose(sessionId)
	})

	test('смоук ядра: spawn runtime=tclaude и runtime=nessy-sdk параллельно → оба отвечают', async () => {
		const bin = process.env['TCLAUDE_PATH'] ?? 'tclaude'
		const h = await startHarness({
			config: { tclaudeBin: bin },
			spaceFactory: (init, listener) =>
				init.runtime === 'tclaude' ? new TclaudeSpace(init, { bin }, listener) : new FakeSpace(init.name, init.path, new FakeAgentPort(), listener),
		})
		try {
			const tclaudeWs = path.join(h.ws, 'tclaude')
			const sdkWs = path.join(h.ws, 'sdk')
			fs.mkdirSync(tclaudeWs, { recursive: true })
			fs.mkdirSync(sdkWs, { recursive: true })
			const [t, s] = await Promise.all([
				h.api('POST', '/agents', { space: tclaudeWs, runtime: 'tclaude', prompt: 'ответь ровно одним словом: ok', wait: true, waitTimeoutSec: 300 }),
				h.api('POST', '/agents', { space: sdkWs, runtime: 'nessy-sdk', prompt: 'ответь ok', wait: true, waitTimeoutSec: 60 }),
			])
			assert.equal(t.status, 201, `tclaude spawn: ${JSON.stringify(t.body).slice(0, 300)}`)
			assert.equal(s.status, 201, `nessy-sdk spawn: ${JSON.stringify(s.body).slice(0, 300)}`)
			const tAgent = (t.body as { agent?: { runtime?: string; model?: string | null } }).agent
			const sAgent = (s.body as { agent?: { runtime?: string } }).agent
			assert.equal(tAgent?.runtime, 'tclaude')
			assert.equal(sAgent?.runtime, 'nessy-sdk')
			const tReply = (t.body as { reply?: { text?: string } }).reply?.text ?? ''
			const sReply = (s.body as { reply?: { text?: string } }).reply?.text ?? ''
			assert.ok(tReply.trim().length > 0, `tclaude не ответил: ${JSON.stringify(t.body).slice(0, 300)}`)
			assert.ok(sReply.trim().length > 0, `nessy-sdk не ответил: ${JSON.stringify(s.body).slice(0, 300)}`)
		} finally {
			await h.close()
		}
	})
}
