#!/usr/bin/env node
/**
 * fake-nessy — имитация `nessy serve` для тестов и демо UI (без модели и без сети).
 * Повторяет контракт docs/contract/README.md: /health, POST /session (независимые сессии), POST /prompt,
 * GET /events (SSE с Last-Event-ID), cancel (→ prompt_cancelled), permission, load, DELETE.
 *
 * События как у настоящего serve: чанки с messageId, мысли, tool_call (title/rawInput) →
 * tool_call_update (in_progress) → tool_call_update (completed, rawOutput "" + content[]).
 *
 * Поведение по последней строке промпта (без вводной и напоминаний оркестратора — строк «[nessy-orch] …»):
 *   «#shell <cmd>»     → вызов run_shell_command (без реального запуска)
 *   «#perm <cmd>»      → то же, но сначала permission_request; продолжает только после голосования
 *   «#slow»            → долгий ответ (~1.5 с), можно прервать cancel
 *   «#long»            → короткий комментарий, инструмент, затем ответ с markdown (заголовки, список, код, таблица), стримится ~3 с
 *   «#tools»           → три инструмента подряд (read_file, grep, run_shell_command) с комментариями между ними и итоговым сообщением
 *   «#plan»            → ACP-план из трёх шагов; статусы продвигаются по мере трёх инструментов, в конце все completed
 *   «#error»           → ошибка хода (agent_message_chunk с _meta['nessy/error']) + turn_complete
 *   «#fail»            → аварийное завершение сессии (session_died)
 *   «#relay <args>»    → выполнить shell `$FAKE_NESSY_CLI send <args>` (как сделал бы реальный агент)
 *   «#work[~] K шаг => Tool: арг; шаг => ?Tool: арг; … || ответ» — план из шагов (для демо и e2e UI):
 *                        первые K шагов проходятся сразу, на шаге K+1 агент «работает» (инструмент не завершается),
 *                        пока ход не прервут; «~» — дальше идти по шагу раз в FAKE_NESSY_WORK_MS (2500 мс) до ответа;
 *                        «?» перед инструментом — сначала запрос разрешения, после «Разрешить» — до конца с ответом.
 *                        Ответ после «||», «\n» — перевод строки. K ≥ числа шагов — сразу ответ.
 *   иначе              → эхо: «ответ: <текст>»
 *
 * Сценарий вне промпта (для демо с человеческими поручениями): если последняя строка не начинается с «#»,
 * ищется файл `$NESSY_ORCH_HOME/fake-scenarios.json` — объект {«подстрока промпта»: сценарий}. Сценарий — либо строка
 * с любым из «#…» выше (в т.ч. многострочным ответом `#work`), либо массив операций:
 *   {thought}, {text}, {plan: {steps, statuses}}, {tool: {name, kind, title, input, output}},
 *   {ask: «заголовок»} (запрос разрешения; после «Разрешить» сценарий идёт дальше, иначе — остановка),
 *   {hang: «заголовок»} (инструмент «в работе», ход не завершается).
 *
 * FAKE_NESSY_DELAY_MS — шаг стриминга (по умолчанию 20 мс).
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as http from 'node:http'

interface Frame {
	id: number
	event: string
	data: string
}
interface Turn {
	promptId: string
	timers: Set<NodeJS.Timeout>
	done: boolean
	/** ожидающий запрос разрешения: requestId → продолжение */
	permission: Map<string, (approved: boolean) => void>
}
interface Session {
	id: string
	seq: number
	ring: Frame[]
	subs: Set<http.ServerResponse>
	turn: Turn | null
	named: boolean
	/** токены нарастающим итогом (GET /session/:id/stats) */
	tokens: { input: number; output: number; cached: number }
}
type Json = Record<string, unknown>

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
	const i = argv.indexOf(name)
	return i === -1 ? undefined : argv[i + 1]
}
if (argv[0] !== 'serve') {
	console.error('fake-nessy: поддерживается только `serve`')
	process.exit(2)
}
const port = parseInt(flag('--port') ?? '0', 10)
const workspace = flag('--workspace') ?? process.cwd()
const sessions = new Map<string, Session>()
const STEP = parseInt(process.env['FAKE_NESSY_DELAY_MS'] ?? '20', 10)
const WORK_STEP = parseInt(process.env['FAKE_NESSY_WORK_MS'] ?? '2500', 10)

// ---------- события ----------
const write = (r: http.ServerResponse, f: Frame): void => {
	r.write(`id: ${f.id}\nevent: ${f.event}\ndata: ${f.data}\n\n`)
}
function emit(s: Session, event: string, payload: Json): void {
	const id = ++s.seq
	const f: Frame = { id, event, data: JSON.stringify({ id, v: 1, type: event, data: { sessionId: s.id, ...payload } }) }
	s.ring.push(f)
	for (const r of s.subs) write(r, f)
}
const update = (s: Session, u: Json): void => emit(s, 'session_update', { update: u })

/** Сценарий одного хода: последовательность шагов со своими задержками; отменяется целиком. */
class Script {
	private t = 0
	constructor(
		private readonly s: Session,
		private readonly turn: Turn,
	) {}

	at(delay: number, fn: () => void): this {
		this.t += delay
		const timer = setTimeout(() => {
			this.turn.timers.delete(timer)
			if (!this.turn.done) fn()
		}, this.t)
		this.turn.timers.add(timer)
		return this
	}

	/** Продолжить сценарий с нуля по времени (после асинхронного шага). */
	restart(): this {
		this.t = 0
		return this
	}

	text(str: string, messageId: string, step = STEP, size = 12): this {
		for (const part of str.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [])
			this.at(step, () => update(this.s, { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: part } }))
		return this
	}

	thought(str: string, messageId: string): this {
		return this.at(STEP, () => update(this.s, { sessionUpdate: 'agent_thought_chunk', messageId, content: { type: 'text', text: str } }))
	}

	/** tool_call (pending, с title/rawInput) → update in_progress → update completed (rawOutput "" + content). */
	tool(name: string, kind: string, title: string, input: Json, output: string): this {
		const toolCallId = 'call_' + randomUUID().slice(0, 8)
		this.at(STEP, () =>
			update(this.s, { sessionUpdate: 'tool_call', toolCallId, title, kind, status: 'pending', rawInput: input, content: [], locations: [], _meta: { toolName: name } }),
		)
		this.at(STEP, () => update(this.s, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' }))
		this.at(STEP * 3, () =>
			update(this.s, {
				sessionUpdate: 'tool_call_update',
				toolCallId,
				status: 'completed',
				rawOutput: '',
				content: [{ type: 'content', content: { type: 'text', text: output } }],
			}),
		)
		return this
	}

	/** ACP `plan`: план целиком; statuses — статус каждого шага по порядку. */
	plan(steps: readonly string[], statuses: readonly string[]): this {
		const entries = steps.map((content, i) => ({ content, priority: 'medium', status: statuses[i] ?? 'pending' }))
		return this.at(STEP, () => update(this.s, { sessionUpdate: 'plan', entries }))
	}

	finish(stopReason = 'end_turn'): this {
		return this.at(STEP, () => endTurn(this.s, this.turn, stopReason))
	}
}

function endTurn(s: Session, turn: Turn, stopReason: string): void {
	if (turn.done) return
	turn.done = true
	for (const t of turn.timers) clearTimeout(t)
	turn.timers.clear()
	if (s.turn === turn) s.turn = null
	// токены хода растут вместе с числом событий — для демо; нарастающий итог отдаёт GET /session/:id/stats
	const input = 900 + s.seq * 35
	const output = 150 + s.seq * 8
	const cached = Math.floor(input * 0.4)
	s.tokens = { input: s.tokens.input + input, output: s.tokens.output + output, cached: s.tokens.cached + cached }
	emit(s, 'turn_complete', { stopReason, promptId: turn.promptId, usage: { inputTokens: input, outputTokens: output, cachedReadTokens: cached, totalTokens: input + output } })
}

const LONG_ANSWER = `## План проверки

Нашёл три места, которые стоит посмотреть:

1. **Парсер SSE** — разбирает кадры по \`\\n\\n\`.
2. **Маппер событий** — сливает \`tool_call\` и \`tool_call_update\`.
3. *Очередь сообщений* — порядок сохраняется.

### Пример

\`\`\`ts
const parser = new SseParser(f => frames.push(f))
parser.push('data: {"a":1}\\n\\n')
\`\`\`

| Компонент | Статус | Комментарий |
|---|---|---|
| sse | ✅ | покрыт тестами |
| mapper | ✅ | все события контракта |
| queue | ⚠️ | нужен тест на рестарт |

> Итог: можно мержить после зелёного прогона.
`

function runPrompt(s: Session, promptId: string, text: string): void {
	const turn: Turn = { promptId, timers: new Set(), done: false, permission: new Map() }
	s.turn = turn
	let body =
		text
			.split('\n')
			.filter(l => l && !l.startsWith('[nessy-orch]'))
			.pop() ?? ''
	const msgId = 'msg_' + randomUUID().slice(0, 8)
	const sc = new Script(s, turn)
	const inline = /^#(fail|error|slow|long|tools|plan|shell|perm|work|relay)/.test(body)
	const external = inline ? null : lookupScenario(text)
	update(s, { sessionUpdate: 'user_message_chunk', messageId: 'user_' + promptId.slice(0, 8), content: { type: 'text', text } })
	if (!s.named) {
		s.named = true
		const displayName = (external ? external.key : body).slice(0, 40)
		sc.at(STEP, () => emit(s, 'session_metadata_updated', { displayName, titleSource: 'auto' }))
	}

	if (external) {
		if (typeof external.scenario === 'string') body = external.scenario
		else {
			runOps(s, turn, sc, external.scenario, 0)
			return
		}
	}

	if (body.startsWith('#fail')) {
		sc.at(STEP, () => {
			turn.done = true
			emit(s, 'session_died', { reason: 'crash' })
			for (const r of s.subs) r.end()
			sessions.delete(s.id)
		})
		return
	}
	if (body.startsWith('#error')) {
		sc.thought('пробую ответить', msgId).at(STEP, () =>
			update(s, {
				sessionUpdate: 'agent_message_chunk',
				messageId: msgId,
				content: { type: 'text', text: 'Rate limit exceeded', _meta: { 'nessy/error': { message: 'Rate limit exceeded', retryable: true, code: 429 } } },
			}),
		)
		sc.finish('end_turn')
		return
	}
	if (body.startsWith('#slow')) {
		sc.thought('думаю долго…', msgId).text('медленный ответ', msgId).at(1500, () => endTurn(s, turn, 'end_turn'))
		return
	}
	if (body.startsWith('#long')) {
		sc.thought('Собираю обзор: посмотрю парсер, маппер и очередь, потом сведу в таблицу.', msgId)
		const step = Math.max(5, Math.floor(3000 / Math.ceil(LONG_ANSWER.length / 8)))
		sc.text('Смотрю исходники.', msgId)
			.tool('read_file', 'read', 'Read: src/sse.ts', { path: 'src/sse.ts' }, 'export class SseParser {}')
			.text(LONG_ANSWER, 'msg_' + randomUUID().slice(0, 8), step, 8)
			.finish()
		return
	}
	if (body.startsWith('#tools')) {
		sc.thought('Сначала прочитаю README, потом поищу TODO и запущу тесты.', msgId)
			.text('Читаю README.', msgId)
			.tool('read_file', 'read', 'Read: README.md', { path: 'README.md' }, '# nessy-orch\nОркестратор агентов nessy.')
			.text('README прочитан, ищу TODO.', 'msg_' + randomUUID().slice(0, 8))
			.tool('grep', 'search', 'Grep: TODO', { pattern: 'TODO', path: 'src' }, 'src/app.ts:12: // TODO: метрики\nsrc/main.ts:40: // TODO: graceful reload')
			.text('Запускаю тесты.', 'msg_' + randomUUID().slice(0, 8))
			.tool('run_shell_command', 'execute', 'Shell: npm test', { command: 'npm test' }, 'tests 42\npass 42\nfail 0')
			.text('Готово: README прочитан, найдено 2 TODO, тесты зелёные.', 'msg_' + randomUUID().slice(0, 8))
			.finish()
		return
	}
	if (body.startsWith('#plan')) {
		const steps = ['Прочитать README', 'Найти TODO', 'Запустить тесты']
		sc.thought('Сессия из трёх шагов — сначала план.', msgId)
			.plan(steps, ['in_progress', 'pending', 'pending'])
			.tool('read_file', 'read', 'Read: README.md', { path: 'README.md' }, '# nessy-orch')
			.plan(steps, ['completed', 'in_progress', 'pending'])
			.tool('grep', 'search', 'Grep: TODO', { pattern: 'TODO', path: 'src' }, 'src/app.ts:12: // TODO')
			.plan(steps, ['completed', 'completed', 'in_progress'])
			.tool('run_shell_command', 'execute', 'Shell: npm test', { command: 'npm test' }, 'pass 42')
			.plan(steps, ['completed', 'completed', 'completed'])
			.text('План выполнен: README прочитан, TODO найдены, тесты зелёные.', 'msg_' + randomUUID().slice(0, 8))
			.finish()
		return
	}
	if (body.startsWith('#shell') || body.startsWith('#perm')) {
		const cmd = body.replace(/^#(shell|perm)\s*/, '') || 'echo ok'
		const runTool = (): void => {
			sc.restart().tool('run_shell_command', 'execute', `Shell: ${cmd}`, { command: cmd }, `вывод команды: ${cmd}`).text(`выполнено: ${cmd}`, msgId).finish()
		}
		sc.thought('нужно выполнить команду', msgId)
		if (!body.startsWith('#perm')) {
			sc.at(0, runTool)
			return
		}
		const requestId = 'perm_' + randomUUID().slice(0, 8)
		sc.at(STEP, () => {
			turn.permission.set(requestId, approved => {
				if (approved) runTool()
				else sc.restart().text('пользователь отклонил команду', msgId).finish()
			})
			emit(s, 'permission_request', {
				requestId,
				toolCall: { toolCallId: 'call_' + requestId, title: `Shell: ${cmd}`, _meta: { toolName: 'run_shell_command' } },
				options: [
					{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' },
					{ optionId: 'proceed_always', kind: 'allow_always', name: 'Разрешать всегда' },
					{ optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' },
				],
			})
		})
		return
	}
	if (body.startsWith('#work')) {
		runWork(s, turn, sc, body, msgId)
		return
	}
	if (body.startsWith('#relay')) {
		const cmd = `${process.env['FAKE_NESSY_CLI'] ?? 'nessy-orch'} send ${body.replace(/^#relay\s+/, '')}`
		const toolCallId = 'call_' + randomUUID().slice(0, 8)
		sc.thought('напишу другому агенту', msgId).at(STEP, () => {
			update(s, { sessionUpdate: 'tool_call', toolCallId, kind: 'execute', status: 'in_progress', title: `Shell: ${cmd}`, rawInput: { command: cmd }, _meta: { toolName: 'run_shell_command' } })
			const p = spawn('/bin/sh', ['-c', cmd], { env: process.env })
			let buf = ''
			p.stdout.on('data', (d: Buffer) => (buf += d.toString()))
			p.stderr.on('data', (d: Buffer) => (buf += d.toString()))
			p.on('close', code => {
				if (turn.done) return
				const out = buf.trim() || '(пусто)'
				update(s, {
					sessionUpdate: 'tool_call_update',
					toolCallId,
					status: code === 0 ? 'completed' : 'failed',
					rawOutput: '',
					content: [{ type: 'content', content: { type: 'text', text: out } }],
				})
				sc.restart().text(`выполнено: ${out.slice(0, 80)}`, msgId).finish()
			})
		})
		return
	}
	// ответ другого агента (последняя строка — «Статус: …») не эхо-ем: просто принимаем к сведению
	const reaction = /^Статус:/.test(body) ? 'Принято, учту в отчёте.' : `ответ: ${body}`
	sc.thought('обдумываю запрос', msgId).text(reaction, msgId).finish()
}

type Op = Json
/** Сценарий для промпта из `$NESSY_ORCH_HOME/fake-scenarios.json`: первое совпадение по подстроке. */
function lookupScenario(text: string): { key: string; scenario: string | Op[] } | null {
	const home = process.env['NESSY_ORCH_HOME']
	if (!home) return null
	try {
		const all = JSON.parse(fs.readFileSync(path.join(home, 'fake-scenarios.json'), 'utf8')) as Record<string, string | Op[]>
		for (const [key, scenario] of Object.entries(all)) if (text.includes(key)) return { key, scenario }
	} catch {
		/* файла нет или он битый — обычное эхо */
	}
	return null
}

const opStr = (v: unknown): string => (typeof v === 'string' ? v : '')
const opObj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})

/** Играет массив операций; на {ask} ждёт голосования и продолжает с следующей операции. */
function runOps(s: Session, turn: Turn, sc: Script, ops: Op[], from: number): void {
	for (let i = from; i < ops.length; i++) {
		const op = ops[i] ?? {}
		const id = 'msg_' + randomUUID().slice(0, 8)
		if (typeof op['thought'] === 'string') sc.thought(op['thought'], id)
		else if (typeof op['text'] === 'string') sc.text(op['text'], id, STEP, 24)
		else if (op['plan']) {
			const p = opObj(op['plan'])
			sc.plan((p['steps'] as string[] | undefined) ?? [], (p['statuses'] as string[] | undefined) ?? [])
		} else if (op['tool']) {
			const t = opObj(op['tool'])
			sc.tool(opStr(t['name']), opStr(t['kind']) || 'execute', opStr(t['title']), opObj(t['input']), opStr(t['output']))
		} else if (typeof op['hang'] === 'string') {
			const title = op['hang']
			const toolCallId = 'call_' + randomUUID().slice(0, 8)
			sc.at(STEP, () => update(s, { sessionUpdate: 'tool_call', toolCallId, title, kind: 'execute', status: 'in_progress', rawInput: {}, _meta: { toolName: 'shell' } }))
			return
		} else if (typeof op['ask'] === 'string') {
			const title = op['ask']
			const requestId = 'perm_' + randomUUID().slice(0, 8)
			sc.at(STEP, () => {
				turn.permission.set(requestId, approved => {
					sc.restart()
					if (approved) runOps(s, turn, sc, ops, i + 1)
					else sc.text('Пользователь отклонил команду — останавливаюсь.', id).finish()
				})
				emit(s, 'permission_request', {
					requestId,
					toolCall: { toolCallId: 'call_' + requestId, title, _meta: { toolName: 'shell' } },
					options: [
						{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' },
						{ optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' },
					],
				})
			})
			return
		}
	}
	sc.finish()
}

/** «#work[~] K шаг => Tool: арг; … || ответ» — см. шапку файла. */
function runWork(s: Session, turn: Turn, sc: Script, body: string, msgId: string): void {
	const m = /^#work(~?)\s+(\d+)\s+([^|]*)(?:\|\|\s*([\s\S]*))?$/.exec(body)
	const slow = m?.[1] === '~'
	const fast = parseInt(m?.[2] ?? '0', 10)
	const steps = (m?.[3] ?? '')
		.split(';')
		.map(x => x.trim())
		.filter(Boolean)
		.map(x => {
			const [content = x, tool = ''] = x.split('=>').map(y => y.trim())
			const ask = tool.startsWith('?')
			const title = ask ? tool.slice(1).trim() : tool
			return { content, title: title || `Think: ${content}`, ask }
		})
	const reply = (m?.[4] ?? 'Готово.').replace(/\\n/g, '\n')
	const names = steps.map(x => x.content)
	const statuses = (done: number, active: number): string[] => steps.map((_, i) => (i < done ? 'completed' : i === active ? 'in_progress' : 'pending'))
	const toolName = (title: string): string => (title.split(':')[0] ?? 'tool').trim().toLowerCase() || 'tool'
	/** шаг i целиком: план «в работе» → инструмент → план «сделан» */
	const step = (i: number): void => {
		const x = steps[i]
		if (!x) return
		sc.plan(names, statuses(i, i)).tool(toolName(x.title), 'execute', x.title, { step: x.content }, `ok: ${x.content}`).plan(names, statuses(i + 1, i + 1))
	}
	const finish = (): void => {
		sc.text(reply, 'msg_' + randomUUID().slice(0, 8), STEP, 24).finish()
	}
	/** остаток плана с шага i в медленном темпе */
	const slowFrom = (i: number): void => {
		for (let j = i; j < steps.length; j++) {
			sc.at(WORK_STEP, () => undefined)
			step(j)
		}
		finish()
	}
	sc.thought('Составляю план.', msgId)
	for (let i = 0; i < Math.min(fast, steps.length); i++) step(i)
	if (fast >= steps.length) return finish()
	const cur = steps[fast]
	if (!cur) return finish()
	sc.plan(names, statuses(fast, fast))
	if (cur.ask) {
		const requestId = 'perm_' + randomUUID().slice(0, 8)
		sc.at(STEP, () => {
			turn.permission.set(requestId, approved => {
				sc.restart()
				if (!approved) {
					sc.text('Пользователь отклонил команду — останавливаюсь.', msgId).finish()
					return
				}
				step(fast)
				slowFrom(fast + 1)
			})
			emit(s, 'permission_request', {
				requestId,
				toolCall: { toolCallId: 'call_' + requestId, title: cur.title, _meta: { toolName: toolName(cur.title) } },
				options: [
					{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' },
					{ optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' },
				],
			})
		})
		return
	}
	if (slow) {
		slowFrom(fast)
		return
	}
	// агент «работает» над шагом: инструмент запущен и не завершается, пока ход не прервут
	const toolCallId = 'call_' + randomUUID().slice(0, 8)
	sc.at(STEP, () =>
		update(s, { sessionUpdate: 'tool_call', toolCallId, title: cur.title, kind: 'execute', status: 'in_progress', rawInput: { step: cur.content }, _meta: { toolName: toolName(cur.title) } }),
	)
}

function cancelTurn(s: Session): void {
	const turn = s.turn
	if (!turn || turn.done) return
	for (const t of turn.timers) clearTimeout(t)
	turn.timers.clear()
	turn.permission.clear()
	emit(s, 'prompt_cancelled', { promptId: turn.promptId })
	endTurn(s, turn, 'cancelled')
}

// ---------- HTTP ----------
function readJson(req: http.IncomingMessage): Promise<Json> {
	return new Promise(resolve => {
		let d = ''
		req.on('data', (c: Buffer) => (d += c.toString()))
		req.on('end', () => {
			try {
				const v: unknown = JSON.parse(d || '{}')
				resolve(typeof v === 'object' && v !== null ? (v as Json) : {})
			} catch {
				resolve({})
			}
		})
	})
}
const json = (res: http.ServerResponse, code: number, body?: unknown): void => {
	if (body === undefined) {
		res.writeHead(code)
		res.end()
		return
	}
	res.writeHead(code, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(body))
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const url = new URL(req.url ?? '/', 'http://x')
	const seg = url.pathname.split('/').filter(Boolean)
	if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' })
	if (req.method === 'POST' && url.pathname === '/session') {
		const b = await readJson(req)
		if (typeof b['cwd'] === 'string' && b['cwd'] !== workspace) return json(res, 400, { code: 'workspace_mismatch', error: 'workspace mismatch' })
		const s: Session = { id: randomUUID(), seq: 0, ring: [], subs: new Set(), turn: null, named: false, tokens: { input: 0, output: 0, cached: 0 } }
		sessions.set(s.id, s)
		return json(res, 200, { sessionId: s.id, workspaceCwd: workspace, attached: false, clientId: randomUUID(), createdAt: new Date().toISOString() })
	}
	const s = seg[0] === 'session' && seg[1] ? sessions.get(seg[1]) : undefined
	if (seg[0] === 'session' && !s) return json(res, 404, { error: 'session not found' })
	if (!s) return json(res, 404, { error: 'not found' })
	const action = seg[2]
	if (req.method === 'GET' && action === 'events') {
		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
		res.write(': connected\n\n')
		const last = parseInt(String(req.headers['last-event-id'] ?? '0'), 10) || 0
		for (const f of s.ring) if (f.id > last) write(res, f)
		s.subs.add(res)
		req.on('close', () => s.subs.delete(res))
		return
	}
	if (req.method === 'POST' && action === 'prompt') {
		const b = await readJson(req)
		const parts = Array.isArray(b['prompt']) ? (b['prompt'] as Json[]) : []
		const text = parts.map(p => (typeof p['text'] === 'string' ? p['text'] : '')).join('\n')
		if (s.turn && !s.turn.done) return json(res, 409, { error: 'prompt already running' })
		const promptId = randomUUID()
		json(res, 200, { promptId, lastEventId: s.seq })
		runPrompt(s, promptId, text)
		return
	}
	if (req.method === 'GET' && action === 'stats') {
		const t = s.tokens
		return json(res, 200, { session: { tokens: { inputTokens: t.input, outputTokens: t.output, cachedReadTokens: t.cached, totalTokens: t.input + t.output } } })
	}
	if (req.method === 'POST' && action === 'cancel') {
		cancelTurn(s)
		return json(res, 204)
	}
	if (req.method === 'POST' && action === 'permission' && seg[3]) {
		const b = await readJson(req)
		const outcome = typeof b['outcome'] === 'object' && b['outcome'] !== null ? (b['outcome'] as Json) : {}
		const cont = s.turn?.permission.get(seg[3])
		if (!cont) return json(res, 404, { error: 'no such request' })
		s.turn?.permission.delete(seg[3])
		const approved = outcome['outcome'] === 'selected' && typeof outcome['optionId'] === 'string' && outcome['optionId'].startsWith('proceed')
		cont(approved)
		return json(res, 200, { ok: true })
	}
	if (req.method === 'POST' && action === 'load') return json(res, 200, {})
	if (req.method === 'DELETE' && action === undefined) {
		if (s.turn) {
			for (const t of s.turn.timers) clearTimeout(t)
			s.turn.done = true
		}
		for (const r of s.subs) r.end()
		sessions.delete(s.id)
		return json(res, 204)
	}
	json(res, 404, { error: 'not found' })
}

const server = http.createServer((req, res) => {
	handle(req, res).catch((e: unknown) => json(res, 500, { error: String(e) }))
})
server.listen(port, '127.0.0.1', () => console.log(`fake-nessy listening on ${port} workspace=${workspace}`))

const shutdown = (): void => {
	server.closeAllConnections()
	server.close()
	process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
// Если родитель (оркестратор/тест) исчез или не смог послать сигнал — не оставаться сиротой.
const parentPid = process.ppid
setInterval(() => {
	if (process.ppid !== parentPid) process.exit(0)
}, 500).unref()
