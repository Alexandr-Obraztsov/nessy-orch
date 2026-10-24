/**
 * Сценарный движок FakeAgentPort: разыгрывание хода по командам («#tools», «#plan», «#perm», «#work», «#relay», эхо).
 * Выделено из fake-agent-port.ts по единой ответственности — «сценарии поведения»; состояние сессии и операции порта
 * остаются в FakeAgentPort.
 */
import { spawn } from 'node:child_process'
import type { Envelope, PortEvent } from '../../src/application/agent-port'
import { lookupScenario, playOps } from './fake-agent-port-external'

/** Сессия фейкового порта: подписчик, состояние разрешений и «зависшего» хода. */
export interface FakeSession {
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

export class ScenarioPlayer {
	constructor(
		private readonly emit: (s: FakeSession, port: PortEvent) => void,
		private readonly stepMs: number,
	) {}

	/** Разыграть ход: сценарная команда или эхо. */
	play(s: FakeSession, text: string): void {
		const steps: Step[] = []
		const step = (ms: number, fn: () => void): void => {
			steps.push([ms, fn])
		}
		const finish = (): void => this.emit(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } })
		const usage = (): void => this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
		const run = (): void => {
			// message.completed, context.usage и завершение хода — в конце сценария
			step(0, () => this.emit(s, { type: 'message.completed', data: { messageId: null, text: '' } }))
			step(0, usage)
			step(0, finish)
			let at = 0
			for (const [ms, fn] of steps) {
				at += ms
				setTimeout(fn, at)
			}
		}

		const t =
			text
				.split('\n')
				.filter(l => l && !l.startsWith('[nessy-orch]'))
				.pop() ?? text
		let body = t.trim()
		// внешний сценарий из fake-scenarios.json — только для промптов без собственной «#»-команды
		const external = /^#(fail|error|slow|long|tools|plan|shell|perm|work|relay|hang|cancel)/.test(body) ? null : lookupScenario(text)
		if (!s.named) {
			// первый промпт: имя сессии (displayName) из тела запроса (или ключа внешнего сценария), как у настоящего рантайма
			s.named = true
			this.emit(s, { type: 'session.meta', data: { displayName: (external ? external.key : body).slice(0, 40) } })
		}
		if (external) {
			if (typeof external.scenario === 'string') body = external.scenario
			else {
				const ops = external.scenario
				const done = (): void => {
					this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
					finish()
				}
				setTimeout(() => playOps(this.emit, s, ops, 0, done), this.stepMs)
				return
			}
		}
		if (body.startsWith('#hang') || body.startsWith('#cancel')) {
			s.hang = true // держим ход открытым до promptCancel
			return
		}
		if (body.startsWith('#slow')) {
			// медленный ход: «медленный ответ» и завершение через ~4с; до этого можно отменить/перезапустить.
			// 4с > времени закрытия стенда, чтобы mid-turn сообщение успело уйти в очередь при рестарте.
			s.hang = true
			this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'думаю долго…' } })
			setTimeout(() => {
				if (!s.hang) return // отменён
				s.hang = false
				this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'медленный ответ' } })
				this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
				this.emit(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } })
			}, 4000)
			return
		}
		if (body.startsWith('#fail')) {
			// serve-специфичный случай (session_died) — эмитим error(died) и закрываем ход
			step(this.stepMs, () => this.emit(s, { type: 'error', data: { message: 'процесс агента nessy завершился', reason: 'died' } }))
			step(0, () => this.emit(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } }))
			run()
			return
		}
		if (body.startsWith('#error')) {
			step(this.stepMs, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'ошибка' } }))
			step(this.stepMs, () => this.emit(s, { type: 'turn.failed', data: { message: 'Rate limit exceeded', retryable: true, code: 429 } }))
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
			step(this.stepMs, () =>
				this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'Сначала прочитаю README, потом поищу TODO и запущу тесты.' } }),
			)
			step(0, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'Читаю README.' } }))
			step(0, () => this.toolPort(s, 'read_file', 'read_file', 'Read: README.md', { path: 'README.md' }, '# nessy-orch'))
			step(this.stepMs, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm2', text: 'README прочитан, ищу TODO.' } }))
			step(0, () => this.toolPort(s, 'grep', 'grep', 'Grep: TODO', { pattern: 'TODO', path: 'src' }, 'src/app.ts:12: // TODO'))
			step(this.stepMs, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm3', text: 'Запускаю тесты.' } }))
			step(0, () => this.toolPort(s, 'run_shell_command', 'run_shell_command', 'Shell: npm test', { command: 'npm test' }, 'tests 42'))
			step(this.stepMs, () =>
				this.emit(s, { type: 'message.delta', data: { messageId: 'm4', text: 'Готово: README прочитан, найдено 2 TODO, тесты зелёные.' } }),
			)
			run()
			return
		}
		if (body.startsWith('#plan')) {
			const stepsP = ['Прочитать README', 'Найти TODO', 'Запустить тесты']
			const plan = (statuses: string[]): void =>
				this.emit(s, { type: 'plan.updated', data: { entries: stepsP.map((content, i) => ({ content, status: statuses[i] ?? 'pending' })) } })
			step(this.stepMs, () => this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'Сессия из трёх шагов — сначала план.' } }))
			step(0, () => plan(['in_progress', 'pending', 'pending']))
			step(this.stepMs, () => this.toolPort(s, 'read_file', 'read_file', 'Read: README.md', { path: 'README.md' }, '# nessy-orch'))
			step(0, () => plan(['completed', 'in_progress', 'pending']))
			step(this.stepMs, () => this.toolPort(s, 'grep', 'grep', 'Grep: TODO', { pattern: 'TODO', path: 'src' }, 'src/app.ts:12: // TODO'))
			step(0, () => plan(['completed', 'completed', 'in_progress']))
			step(this.stepMs, () => this.toolPort(s, 'run_shell_command', 'run_shell_command', 'Shell: npm test', { command: 'npm test' }, 'pass 42'))
			step(0, () => plan(['completed', 'completed', 'completed']))
			step(this.stepMs, () =>
				this.emit(s, { type: 'message.delta', data: { messageId: 'm2', text: 'План выполнен: README прочитан, TODO найдены, тесты зелёные.' } }),
			)
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
			step(this.stepMs, () =>
				this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'Собираю обзор: посмотрю парсер, маппер и очередь, потом сведу в таблицу.' } }),
			)
			step(0, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'Смотрю исходники.' } }))
			parts.forEach(p => step(200, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm2', text: p } })))
			run()
			return
		}
		if (body.startsWith('#relay ')) {
			const cli = process.env['FAKE_NESSY_CLI'] ?? 'nessy-orch'
			const cmd = `${cli} send ${body.replace(/^#relay\s+/, '')}`
			step(this.stepMs, () => this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'напишу другому агенту' } }))
			this.relayScenario(s, cmd)
			return
		}
		// эхо и ответы на «Статус: …»
		const reaction = /^Статус:/.test(body) ? 'Принято, учту в отчёте.' : `ответ: ${body}`
		step(this.stepMs, () => this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'обдумываю запрос' } }))
		step(0, () => this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: reaction } }))
		run()
	}

	private toolPort(s: FakeSession, toolId: string, name: string, title: string, input: Record<string, unknown>, output: string): void {
		this.emit(s, { type: 'tool_call.started', data: { toolId, name, title, input } })
		this.emit(s, { type: 'tool_call.completed', data: { toolId, name, title, status: 'completed', output } })
	}

	/** #perm/#shell: permission → голос → инструмент или отказ. */
	private permScenario(s: FakeSession, cmd: string, needsPerm: boolean, finish: () => void): void {
		const runTool = (): void => {
			this.emit(s, { type: 'tool_call.started', data: { toolId: 'call_perm', name: 'run_shell_command', title: `Shell: ${cmd}`, input: { command: cmd } } })
			this.emit(s, {
				type: 'tool_call.completed',
				data: { toolId: 'call_perm', name: 'run_shell_command', title: `Shell: ${cmd}`, status: 'completed', output: `вывод команды: ${cmd}` },
			})
			this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: `выполнено: ${cmd}` } })
			this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
			finish()
		}
		if (!needsPerm) {
			this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'нужно выполнить команду' } })
			setTimeout(runTool, this.stepMs)
			return
		}
		const requestId = `perm_${s.id}`
		this.emit(s, { type: 'thought.delta', data: { messageId: 'm1', text: 'нужно выполнить команду' } })
		s.permissions.set(requestId, approved => {
			if (approved) runTool()
			else {
				this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'пользователь отклонил команду' } })
				this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
				finish()
			}
		})
		this.emit(s, {
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
			this.emit(s, { type: 'thought.delta', data: { messageId: 'w1', text: title } })
			const runStep = (): void => {
				this.emit(s, { type: 'tool_call.started', data: { toolId: 'call_' + title, name: toolName, title, input: { arg } } })
				this.emit(s, { type: 'tool_call.completed', data: { toolId: 'call_' + title, name: toolName, title, status: 'completed', output: `вывод: ${arg}` } })
			}
			if (needsPerm) {
				const requestId = 'perm_' + title + '_' + s.id
				s.permissions.set(requestId, approved => {
					if (approved) runStep()
				})
				this.emit(s, {
					type: 'permission.requested',
					data: {
						requestId,
						title,
						options: [
							{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' },
							{ optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' },
						],
					},
				})
			} else {
				runStep()
			}
		}
		if (ans) this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: ans } })
		this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
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
			this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: `выполнено: ${out.slice(0, 80)}` } })
			this.emit(s, { type: 'context.usage', data: { used: 100, size: 524_000 } })
			this.emit(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: null } })
		})
	}
}
