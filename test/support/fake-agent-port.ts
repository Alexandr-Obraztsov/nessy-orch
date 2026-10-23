/**
 * FakeAgentPort — детерминированная реализация AgentPort для тестов ядра и conformance-сьюта (§10 дизайна).
 * Является и тестовым стендом интеграционных тестов (развитие fake-nessy): в autoRespond-режиме реагирует на
 * сценарные команды, как делал фейковый nessy serve, но события шлёт через порт (Envelope) прямо агенту.
 *
 * Режимы:
 *  - autoRespond=true (по умолчанию): операции сами эмитят события. promptSend разыгрывает сценарные команды:
 *    «#slow»/«#hang» держат ход открытым до отмены, «#perm <cmd>» — permission.requested→голос→инструмент,
 *    «#shell <cmd>» — инструмент без спроса, «#error» — turn.failed, «#tools»/«#plan»/«#long» — многошаговые сценарии,
 *    «#work …» — план с permission-шагами, «#relay …» — запуск CLI, «Статус:…» — ответ «Принято…», остальное — эхо.
 *  - autoRespond=false (для unit-тестов ядра): операции только записывают факт, события присылает тест методом emit().
 *
 * emit() принимает нативные SessionEvent и нормализует их в контрактные события порта (sessionEventToPortEvent).
 */
import { spawn } from 'node:child_process'
import type { AgentPort, Capabilities, Envelope, PortEvent, PortSubscription, PortSubscribeOptions } from '../../src/application/agent-port'
import { sessionEventToPortEvent } from '../../src/application/agent-port'
import type { SessionEvent } from '../../src/application/ports'
import { NessyBusyError } from '../../src/domain/errors'

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** сквозной счётчик сессий в пределах процесса: после рестарта (новый порт) id не повторяются. */
let sessionSeq = 0

export interface FakeAgentPortOptions {
	/** автоответ на промпт; false — только manual emit() (тесты ядра). По умолчанию true. */
	autoRespond?: boolean
	/** шаг между событиями сценария, мс (по умолчанию 10). */
	stepMs?: number
}

interface FakeSession {
	id: string
	subscriber: ((envelope: Envelope) => void) | null
	ready: boolean
	/** запросы разрешений в ходе (для #perm/#work): requestId → продолжение по голосу. */
	permissions: Map<string, (approved: boolean) => void>
	/** открыт ли ход (#slow/#hang держат его открытым). */
	hang: boolean
	/** первый промпт — имя сессии (session.meta), как у настоящего рантайма. */
	named: boolean
}

/** Очередь шагов сценария: [задержка, действие]. */
type Step = [number, () => void]

export class FakeAgentPort implements AgentPort {
	readonly capabilities: Capabilities = { streamText: true, midTurn: true, permissionVote: true, setModel: true }

	// ---------- контроль теста ----------
	prompts: string[] = []
	votes: Array<{ requestId: string; optionId: string | null }> = []
	cancels = 0
	closed: string[] = []
	restored: string[] = []
	midTurns: string[] = []
	created = 0
	/** id созданных в этом порту сессий в порядке создания (для тестов, где id не должны хардкодиться — счётчик общий на процесс). */
	createdIds: string[] = []
	subscribedFrom: Array<{ sessionId: string; lastSeq: number | null }> = []
	promptGate: Promise<void> | null = null
	busyPrompts = 0
	busySessions = 0
	failCreate = 0
	sessionDelayMs = 0
	acceptMidTurn = false
	canRestore = true

	private seq = 0
	private readonly autoRespond: boolean
	private readonly stepMs: number
	private readonly sessions = new Map<string, FakeSession>()
	/** сессии, созданные в этом порту (живут и после закрытия — для резюма; в новом порту их нет). */
	private readonly known = new Set<string>()

	constructor(opts: FakeAgentPortOptions = {}) {
		this.autoRespond = opts.autoRespond ?? true
		this.stepMs = opts.stepMs ?? 10
		// в autoRespond-режиме (интеграция/conformance) mid-turn в идущий ход принимается, как у настоящего рантайма
		this.acceptMidTurn = opts.autoRespond ?? true
	}

	async sessionCreate(): Promise<{ sessionId: string }> {
		if (this.failCreate > 0) {
			this.failCreate--
			throw new Error('nessy недоступен')
		}
		if (this.busySessions > 0) {
			this.busySessions--
			throw new NessyBusyError('unavailable', 'nessy POST /session → 503: session_limit_exceeded', 5)
		}
		this.created++
		if (this.sessionDelayMs > 0) await delay(this.sessionDelayMs)
		const sessionId = `s-${++sessionSeq}`
		this.createdIds.push(sessionId)
		this.sessions.set(sessionId, { id: sessionId, subscriber: null, ready: false, permissions: new Map(), hang: false, named: false })
		this.known.add(sessionId)
		return { sessionId }
	}

	async sessionResume(sessionId: string): Promise<{ lastSeq: number | null } | null> {
		await delay(0)
		this.restored.push(sessionId)
		// резюм только для сессий ЭТОГО порта (после рестарта старой сессии в новом порту нет → создаётся новая)
		if (!this.canRestore || !this.known.has(sessionId)) return null
		const s = this.ensure(sessionId)
		s.ready = false
		return { lastSeq: 7 }
	}

	async promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		await delay(0)
		this.prompts.push(text)
		if (this.busyPrompts > 0) {
			this.busyPrompts--
			throw new NessyBusyError('queue_full', 'nessy POST /prompt → 503: prompt_queue_full', 5)
		}
		const promptId = `p-${this.prompts.length}`
		if (this.promptGate) await this.promptGate
		if (this.autoRespond) {
			const s = this.ensure(sessionId)
			s.hang = false
			this.emitPort(s, { type: 'turn.started', data: { promptId: null } })
			this.runScenario(s, text)
		}
		return { promptId }
	}

	async promptCancel(sessionId: string): Promise<void> {
		this.cancels++
		await delay(0)
		const s = this.ensure(sessionId)
		if (s.hang) {
			s.hang = false
			this.emitPort(s, { type: 'turn.cancelled', data: { promptId: null } })
		}
	}

	async permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		await delay(0)
		this.votes.push({ requestId, optionId })
		const s = this.ensure(sessionId)
		const resolve = s.permissions.get(requestId)
		if (resolve) {
			s.permissions.delete(requestId)
			resolve(optionId !== null && optionId !== 'deny' && optionId !== 'cancel')
		}
		if (this.autoRespond) this.emitPort(s, { type: 'permission.resolved', data: { requestId, optionId } })
	}

	midTurnSend(sessionId: string, message: string): Promise<boolean> {
		if (!this.acceptMidTurn) return Promise.resolve(false)
		this.midTurns.push(message)
		// модель «забирает» сообщение с задержкой: до неё ход можно отменить/перезапустить и сообщение вернётся в очередь
		setTimeout(() => {
			const s = this.sessions.get(sessionId)
			if (s) this.emitPort(s, { type: 'mid_turn.injected', data: { count: 1 } })
		}, 300)
		return Promise.resolve(true)
	}

	async sessionClose(sessionId: string): Promise<void> {
		await delay(0)
		this.closed.push(sessionId)
		const s = this.ensure(sessionId)
		if (this.autoRespond) this.emitPort(s, { type: 'session.closed', data: { sessionId } })
		this.sessions.delete(sessionId)
	}

	async modelSet(sessionId: string, model: string): Promise<void> {
		await delay(0)
		if (this.autoRespond) this.emitPort(this.ensure(sessionId), { type: 'model.switched', data: { model } })
	}

	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription {
		const s = this.ensure(sessionId)
		s.subscriber = opts.onEvent
		this.subscribedFrom.push({ sessionId, lastSeq: opts.lastSeq ?? null })
		if (!s.ready) {
			s.ready = true
			opts.onEvent(this.wrap(sessionId, { type: 'session.ready', data: { sessionId } }))
		}
		return {
			close(): void {
				if (s.subscriber === opts.onEvent) s.subscriber = null
			},
		}
	}

	/** Прислать нативные SessionEvent всем подписанным сессиям; нормализуются в события порта. */
	emit(...events: SessionEvent[]): void {
		for (const ev of events) {
			const port = sessionEventToPortEvent(ev)
			if (!port) continue
			const envelope = this.wrap(null, port)
			for (const s of this.sessions.values()) s.subscriber?.(envelope)
		}
	}

	// ---------- сценарии ----------
	/** Разыграть ход: сценарная команда или эхо. */
	private runScenario(s: FakeSession, text: string): void {
		const steps: Step[] = []
		const step = (ms: number, fn: () => void): void => {
			steps.push([ms, fn])
		}
		const finish = (): void => this.emitPort(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } })
		const usage = (): void => this.emitPort(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
		const run = (): void => {
			// message.completed, context.usage и завершение хода — в конце сценария
			step(0, () => this.emitPort(s, { type: 'message.completed', data: { messageId: null, text: '' } }))
			step(0, usage)
			step(0, finish)
			let at = 0
			for (const [ms, fn] of steps) {
				at += ms
				setTimeout(fn, at)
			}
		}

		const t = text
			.split('\n')
			.filter(l => l && !l.startsWith('[nessy-orch]'))
			.pop() ?? text
		const body = t.trim()
		if (!s.named) {
			// первый промпт: имя сессии (displayName) из тела запроса, как у настоящего рантайма
			s.named = true
			this.emitPort(s, { type: 'session.meta', data: { displayName: body.slice(0, 40) } })
		}
		if (body.startsWith('#hang') || body.startsWith('#cancel')) {
			s.hang = true // держим ход открытым до promptCancel
			return
		}
		if (body.startsWith('#slow')) {
			// медленный ход: «медленный ответ» и завершение через ~4с; до этого можно отменить/перезапустить.
			// 4с > времени закрытия стенда, чтобы mid-turn сообщение успело уйти в очередь при рестарте.
			s.hang = true
			this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'думаю долго…' } })
			setTimeout(() => {
				if (!s.hang) return // отменён
				s.hang = false
				this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: 'медленный ответ' } })
				this.emitPort(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
				this.emitPort(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } })
			}, 4000)
			return
		}
		if (body.startsWith('#fail')) {
			// serve-специфичный случай (session_died) — эмитим error(died) и закрываем ход
			step(this.stepMs, () => this.emitPort(s, { type: 'error', data: { message: 'процесс агента nessy завершился', reason: 'died' } }))
			step(0, () => this.emitPort(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } }))
			run()
			return
		}
		if (body.startsWith('#error')) {
			step(this.stepMs, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: 'ошибка' } }))
			step(this.stepMs, () => this.emitPort(s, { type: 'turn.failed', data: { message: 'Rate limit exceeded', retryable: true, code: 429 } }))
			run()
			return
		}
		if (body.startsWith('#perm') || body.startsWith('#shell ')) {
			const cmd = body.replace(/^#(perm|shell)\s*/, '').trim() || 'echo ok'
			this.permScenario(s, cmd, body.startsWith('#perm'), finish)
			return
		}
		if (body.startsWith('#work')) {
			this.workScenario(s, body, finish)
			return
		}
		if (body.startsWith('#tools')) {
			step(this.stepMs, () => this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'Сначала прочитаю README, потом поищу TODO и запущу тесты.' } }))
			step(0, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: 'Читаю README.' } }))
			step(0, () => this.toolPort(s, 'read_file', 'read_file', 'Read: README.md', { path: 'README.md' }, '# nessy-orch'))
			step(this.stepMs, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm2', text: 'README прочитан, ищу TODO.' } }))
			step(0, () => this.toolPort(s, 'grep', 'grep', 'Grep: TODO', { pattern: 'TODO', path: 'src' }, 'src/app.ts:12: // TODO'))
			step(this.stepMs, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm3', text: 'Запускаю тесты.' } }))
			step(0, () => this.toolPort(s, 'run_shell_command', 'run_shell_command', 'Shell: npm test', { command: 'npm test' }, 'tests 42'))
			step(this.stepMs, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm4', text: 'Готово: README прочитан, найдено 2 TODO, тесты зелёные.' } }))
			run()
			return
		}
		if (body.startsWith('#plan')) {
			const stepsP = ['Прочитать README', 'Найти TODO', 'Запустить тесты']
			const plan = (statuses: string[]): void => this.emitPort(s, { type: 'plan.updated', data: { entries: stepsP.map((content, i) => ({ content, status: statuses[i] ?? 'pending' })) } })
			step(this.stepMs, () => this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'Сессия из трёх шагов — сначала план.' } }))
			step(0, () => plan(['in_progress', 'pending', 'pending']))
			step(this.stepMs, () => this.toolPort(s, 'read_file', 'read_file', 'Read: README.md', { path: 'README.md' }, '# nessy-orch'))
			step(0, () => plan(['completed', 'in_progress', 'pending']))
			step(this.stepMs, () => this.toolPort(s, 'grep', 'grep', 'Grep: TODO', { pattern: 'TODO', path: 'src' }, 'src/app.ts:12: // TODO'))
			step(0, () => plan(['completed', 'completed', 'in_progress']))
			step(this.stepMs, () => this.toolPort(s, 'run_shell_command', 'run_shell_command', 'Shell: npm test', { command: 'npm test' }, 'pass 42'))
			step(0, () => plan(['completed', 'completed', 'completed']))
			step(this.stepMs, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm2', text: 'План выполнен: README прочитан, TODO найдены, тесты зелёные.' } }))
			run()
			return
		}
		if (body.startsWith('#long')) {
			const answer =
				'## План проверки\n\nНашёл три места, которые стоит посмотреть:\n\n1. **Парсер SSE** — разбирает кадры по `\\n\\n`.\n2. **Маппер событий** — сливает `tool_call` и `tool_call_update`.\n3. *Очередь сообщений* — порядок сохраняется.\n\n### Пример\n\n```ts\nconst parser = new SseParser(f => frames.push(f))\nparser.push(\'data: {"a":1}\\n\\n\')\n```\n\n| Компонент | Статус | Комментарий |\n|---|---|---|\n| sse | ✅ | покрыт тестами |\n| mapper | ✅ | все события контракта |\n| queue | ⚠️ | нужен тест на рестарт |\n\n> Итог: можно мержить после зелёного прогона.\n'
			// стримим чанками (долгий ход для wait-тестов; посреди хода подписчик видит незавершённый блок)
			const parts: string[] = []
			const chunkSize = Math.ceil(answer.length / 8)
			for (let i = 0; i < answer.length; i += chunkSize) parts.push(answer.slice(i, i + chunkSize))
			step(this.stepMs, () => this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'Собираю обзор: посмотрю парсер, маппер и очередь, потом сведу в таблицу.' } }))
			step(0, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: 'Смотрю исходники.' } }))
			parts.forEach(p => step(200, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm2', text: p } })))
			run()
			return
		}
		if (body.startsWith('#relay ')) {
			const cli = process.env['FAKE_NESSY_CLI'] ?? 'nessy-orch'
			const cmd = `${cli} send ${body.replace(/^#relay\s+/, '')}`
			step(this.stepMs, () => this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'напишу другому агенту' } }))
			this.relayScenario(s, cmd)
			return
		}
		// эхо и ответы на «Статус: …»
		const reaction = /^Статус:/.test(body) ? 'Принято, учту в отчёте.' : `ответ: ${body}`
		step(this.stepMs, () => this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'обдумываю запрос' } }))
		step(0, () => this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: reaction } }))
		run()
	}

	private toolPort(s: FakeSession, toolId: string, name: string, title: string, input: Record<string, unknown>, output: string): void {
		this.emitPort(s, { type: 'tool_call.started', data: { toolId, name, title, input } })
		this.emitPort(s, { type: 'tool_call.completed', data: { toolId, name, title, status: 'completed', output } })
	}

	/** #perm/#shell: permission → голос → инструмент или отказ. */
	private permScenario(s: FakeSession, cmd: string, needsPerm: boolean, finish: () => void): void {
		const runTool = (): void => {
			this.emitPort(s, { type: 'tool_call.started', data: { toolId: 'call_perm', name: 'run_shell_command', title: `Shell: ${cmd}`, input: { command: cmd } } })
			this.emitPort(s, { type: 'tool_call.completed', data: { toolId: 'call_perm', name: 'run_shell_command', title: `Shell: ${cmd}`, status: 'completed', output: `вывод команды: ${cmd}` } })
			this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: `выполнено: ${cmd}` } })
			this.emitPort(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
			finish()
		}
		if (!needsPerm) {
			this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'нужно выполнить команду' } })
			setTimeout(runTool, this.stepMs)
			return
		}
		const requestId = `perm_${s.id}`
		this.emitPort(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'нужно выполнить команду' } })
		s.permissions.set(requestId, approved => {
			if (approved) runTool()
			else {
				this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: 'пользователь отклонил команду' } })
				this.emitPort(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
				finish()
			}
		})
		this.emitPort(s, {
			type: 'permission.requested',
			data: {
				requestId,
				title: `Shell: ${cmd}`,
				options: [
					{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' },
					{ optionId: 'proceed_always', kind: 'allow_always', name: 'Разрешать всегда' },
					{ optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' },
				],
			},
		})
	}

	/** #work: план шагов с permission-шагами «→» и «?». */
	private workScenario(s: FakeSession, text: string, finish: () => void): void {
		const body = text.replace(/^#work~\s*/, '').replace(/^#work\s*/, '')
		const [stepsPart = '', answer = ''] = body.split('||')
		const ans = answer.trim()
		const steps = stepsPart
			.split(';')
			.map(x => x.trim())
			.filter(Boolean)
		for (const st of steps) {
			const m = /^(→|\?)\s*(.*?)(?:\s*=>\s*(\w+)\s*:\s*(.+))?$/.exec(st)
			const needsPerm = m?.[1] === '?'
			const title = m?.[2] ?? st
			const toolName = m?.[3] ?? 'shell'
			const arg = m?.[4] ?? ''
			this.emitPort(s, { type: 'thought.delta', data: { messageId: 'w1', text: title } })
			const runStep = (): void => {
				this.emitPort(s, { type: 'tool_call.started', data: { toolId: 'call_' + title, name: toolName, title, input: { arg } } })
				this.emitPort(s, { type: 'tool_call.completed', data: { toolId: 'call_' + title, name: toolName, title, status: 'completed', output: `вывод: ${arg}` } })
			}
			if (needsPerm) {
				const requestId = 'perm_' + title + '_' + s.id
				s.permissions.set(requestId, approved => {
					if (approved) runStep()
				})
				this.emitPort(s, { type: 'permission.requested', data: { requestId, title, options: [{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' }, { optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' }] } })
			} else {
				runStep()
			}
		}
		if (ans) this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: ans } })
		this.emitPort(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
		finish()
	}

	/** #relay: выполнить CLI send (как реальный агент) и вернуть вывод. */
	private relayScenario(s: FakeSession, cmd: string): void {
		const p = spawn('/bin/sh', ['-c', cmd], { env: process.env })
		let buf = ''
		p.stdout.on('data', (d: Buffer) => (buf += d.toString()))
		p.stderr.on('data', (d: Buffer) => (buf += d.toString()))
		p.on('close', () => {
			const out = buf.trim() || '(пусто)'
			this.emitPort(s, { type: 'message.delta', data: { messageId: 'm1', text: `выполнено: ${out.slice(0, 80)}` } })
			this.emitPort(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
			this.emitPort(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } })
		})
	}

	private ensure(sessionId: string): FakeSession {
		let s = this.sessions.get(sessionId)
		if (!s) {
			s = { id: sessionId, subscriber: null, ready: false, permissions: new Map(), hang: false, named: false }
			this.sessions.set(sessionId, s)
		}
		return s
	}

	private emitPort(s: FakeSession, port: PortEvent): void {
		s.subscriber?.(this.wrap(s.id, port))
	}

	private wrap(sessionId: string | null, port: PortEvent): Envelope {
		this.seq += 1
		return { v: 1, sessionId, seq: this.seq, ts: Date.now(), originatorClientId: null, type: port.type, data: port.data }
	}
}