#!/usr/bin/env node
/**
 * nessy-orch — единый CLI оркестратора.
 * Правило вывода: полезный результат (ответ агента, JSON) — в stdout, служебное — в stderr.
 * Так `nessy-orch spawn --wait ...` удобно читать и главному агенту, и скриптам.
 */
import * as path from 'node:path'
import type { AgentEvent, AgentView, GraphView, InboxResponse, Message, SendResponse, SpaceView, SpawnResponse, StatusResponse } from '../../shared/types'
import { errMsg } from '../core/json'
import { flagBool, flagNum, flagStr, parseArgs, type FlagSpec, type Parsed } from './args'
import { CliError, asAgentStreamEvent, asStreamEvent, endpoint, request, sse } from './client'
import { agentsTable, bold, dim, formatMessage, green, red, spacesTable, status, time } from './format'
import { install, uninstall } from './launchd'

const ep = endpoint()

const HELP = `nessy-orch — оркестратор агентов nessy

АГЕНТЫ
  spawn [--space S] [--name N] [--wait] [--timeout СЕК] ["задача"]
                       создать агента (и сразу отправить задачу). --wait — дождаться ответа
  send <агент|you> "текст" [--wait] [--timeout СЕК] [--from ID]
                       отправить сообщение; --from — от имени агента (для самих агентов)
  ask <путь|space> "задача"   короткий путь: spawn --wait (совместим со старым nessy-ask)
  ls                   список агентов            show <агент>   последние события агента
  watch <агент>        живой чат с агентом       cancel <агент>  прервать ход
  kill <агент>         удалить агента

ЛЕНТА И ВХОДЯЩИЕ
  feed [-n 30] [--follow]   общая лента сообщений
  inbox [--wait СЕК] [--peek]   новые ответы агентов вам (курсор сохраняется)

ПРОСТРАНСТВА
  space add <путь> [--name N] [--url URL]    space ls    space rm <имя> [--force]

СЛУЖЕБНОЕ
  status               состояние оркестратора   open   открыть UI
  install [--print]    установить launchd-сервис  uninstall

ОБЩИЕ ФЛАГИ: --json (машинный вывод), --help
Переменные: ORCH_PORT (по умолчанию 4337), NO_COLOR`

const COMMON: FlagSpec = { bool: ['json', 'help'] }

function out(s: string): void {
	process.stdout.write(s + '\n')
}
function info(s: string): void {
	process.stderr.write(s + '\n')
}
function json(v: unknown): void {
	out(JSON.stringify(v, null, 2))
}

const get = <T>(path: string): Promise<T> => request(ep, 'GET', path) as Promise<T>
const post = <T>(path: string, body: unknown): Promise<T> => request(ep, 'POST', path, body) as Promise<T>

async function graph(): Promise<GraphView> {
	return get<GraphView>('/graph')
}

/** Агент по id/имени (проверка на стороне сервера). */
const enc = encodeURIComponent

// ======================================================================
// команды
// ======================================================================
async function cmdStatus(p: Parsed): Promise<void> {
	const s = await get<StatusResponse>('/status')
	if (flagBool(p, 'json')) return json(s)
	out(`${green('●')} nessy-orch ${s.version}  pid ${s.pid}  uptime ${s.uptimeSec}s`)
	out(`  http://127.0.0.1:${ep.port}   home: ${s.home}`)
	out(`  пространств: ${s.spaces}   агентов: ${s.agents} (работают: ${s.working})   автоподтверждение: ${s.autoApprove ? 'вкл' : 'выкл'}`)
}

async function cmdLs(p: Parsed): Promise<void> {
	const g = await graph()
	if (flagBool(p, 'json')) return json(g.agents)
	out(agentsTable(g.agents, g.spaces))
}

async function cmdSpawn(p: Parsed): Promise<void> {
	const prompt = p.positionals.join(' ').trim()
	const wait = flagBool(p, 'wait')
	if (wait && !prompt) throw new CliError('--wait требует текст задачи', 2)
	const r = await post<SpawnResponse>('/agents', {
		space: flagStr(p, 'space'),
		name: flagStr(p, 'name'),
		from: flagStr(p, 'from'),
		prompt: prompt || undefined,
		wait,
		waitTimeoutSec: flagNum(p, 'timeout'),
	})
	printSendResult(p, r.agent, r)
}

async function cmdSend(p: Parsed): Promise<void> {
	const [to, ...rest] = p.positionals
	const text = rest.join(' ').trim()
	if (!to || !text) throw new CliError('использование: nessy-orch send <агент|you> "текст" [--wait] [--from ID]', 2)
	const r = await post<SendResponse>(`/agents/${enc(to)}/send`, {
		text,
		from: flagStr(p, 'from'),
		wait: flagBool(p, 'wait'),
		waitTimeoutSec: flagNum(p, 'timeout'),
	})
	printSendResult(p, null, r)
}

/** Общий вывод для spawn/send: ответ — в stdout, служебное — в stderr. */
function printSendResult(p: Parsed, agent: AgentView | null, r: SendResponse): void {
	if (flagBool(p, 'json')) return json(agent ? { agent, ...r } : r)
	if (agent) info(`${green('✓')} агент ${bold(agent.id)}${agent.name !== agent.id ? ` (${agent.name})` : ''} в «${agent.space}»`)
	if (r.reply) {
		if (r.reply.failed) info(red(`агент ответил с ошибкой: ${r.reply.failed}`))
		out(r.reply.text)
	} else if (r.timedOut) {
		throw new CliError(`ответ не получен за отведённое время; агент продолжает работу: nessy-orch watch ${agent?.id ?? r.message.to}`, 3)
	} else {
		info(dim(`отправлено ${r.message.id} → ${r.message.to}. Ответ придёт в inbox: nessy-orch inbox --wait 60`))
	}
}

async function cmdAsk(p: Parsed): Promise<void> {
	const [space, ...rest] = p.positionals
	const prompt = rest.join(' ').trim()
	if (!space || !prompt) throw new CliError('использование: nessy-orch ask <путь|пространство> "задача"', 2)
	const r = await post<SpawnResponse>('/agents', { space, prompt, wait: true, waitTimeoutSec: flagNum(p, 'timeout') })
	printSendResult(p, r.agent, r)
}

async function cmdShow(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch show <агент>', 2)
	const [a, ev] = await Promise.all([get<AgentView>(`/agents/${enc(ref)}`), get<AgentEvent[]>(`/agents/${enc(ref)}/history?limit=${flagNum(p, 'n') ?? 40}`)])
	if (flagBool(p, 'json')) return json({ agent: a, events: ev })
	out(`${bold(a.id)} ${a.name !== a.id ? `(${a.name}) ` : ''}${status(a.status)}  ${a.space}${a.displayName ? `  «${a.displayName}»` : ''}`)
	for (const e of ev) out(renderEvent(e))
}

function renderEvent(e: AgentEvent): string {
	const t = dim(time(e.ts))
	switch (e.kind) {
		case 'user':
			return `${t} ${bold(`← ${e.from}`)}\n${indent(e.text)}`
		case 'text':
			return `${t} ${green('▸')}\n${indent(e.text)}`
		case 'thought':
			return dim(`${time(e.ts)} … ${e.text.replace(/\s+/g, ' ').slice(0, 160)}`)
		case 'tool':
			return `${t} ${bold('⚙ ' + e.name)} ${dim(e.title)} ${dim(`[${e.status}]`)}`
		case 'permission':
			return dim(`${time(e.ts)} 🔑 ${e.title} ${e.resolved ? (e.approved ? '— разрешено' + (e.auto ? ' автоматически' : '') : '— отклонено') : '— ждёт решения'}`)
		case 'system':
			return e.level === 'error' ? red(`${time(e.ts)} ! ${e.text}`) : dim(`${time(e.ts)} · ${e.text}`)
	}
}
const indent = (s: string): string =>
	s
		.split('\n')
		.map(l => '    ' + l)
		.join('\n')

/** Живой чат агента: история + новые события; завершение по Ctrl+C. */
async function cmdWatch(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch watch <агент>', 2)
	const seen = new Map<number, string>()
	const live = new Map<number, number>() // seq → уже выведено символов
	let inText: number | null = null
	const stream = sse(ep, `/agents/${enc(ref)}/stream`, raw => {
		const ev = asAgentStreamEvent(raw)
		if (!ev) return
		if (ev.t === 'chunk' && ev.chunk.kind === 'text') {
			if (inText !== ev.chunk.seq) {
				process.stdout.write(`\n${dim(time(ev.chunk.ts))} ${green('▸')} `)
				inText = ev.chunk.seq
			}
			process.stdout.write(ev.chunk.delta)
			live.set(ev.chunk.seq, ev.chunk.len)
		} else if (ev.t === 'event') {
			const e = ev.event
			if (e.kind === 'text' && live.has(e.seq)) {
				inText = null
				return // уже напечатан по чанкам
			}
			const key = JSON.stringify([e.kind, e.seq, 'status' in e ? e.status : '', 'resolved' in e ? e.resolved : ''])
			if (seen.get(e.seq) === key) return
			seen.set(e.seq, key)
			if (e.kind === 'thought') return // мысли в живом выводе не показываем
			if (e.kind === 'tool' && e.output && e.status !== 'in_progress') {
				out(`${dim(time(e.ts))} ${bold('✔ ' + e.name)} ${dim(e.output.replace(/\s+/g, ' ').slice(0, 160))}`)
				return
			}
			inText = null
			out('\n' + renderEvent(e))
		}
	})
	process.on('SIGINT', () => {
		stream.close()
		process.exit(0)
	})
	await stream.done
	out('')
}

async function cmdFeed(p: Parsed): Promise<void> {
	const g = await graph()
	const agents = new Map(g.agents.map(a => [a.id, a]))
	const n = flagNum(p, 'n') ?? 30
	const list = await get<Message[]>(`/messages?limit=${n}`)
	if (flagBool(p, 'json') && !flagBool(p, 'follow')) return json(list)
	for (const m of list) out(flagBool(p, 'json') ? JSON.stringify(m) : formatMessage(m, agents))
	if (!flagBool(p, 'follow')) return
	const stream = sse(ep, '/stream', raw => {
		const ev = asStreamEvent(raw)
		if (!ev) return
		if (ev.t === 'agent') agents.set(ev.agent.id, ev.agent)
		else if (ev.t === 'message') out(flagBool(p, 'json') ? JSON.stringify(ev.message) : formatMessage(ev.message, agents))
	})
	process.on('SIGINT', () => {
		stream.close()
		process.exit(0)
	})
	await stream.done
}

async function cmdInbox(p: Parsed): Promise<void> {
	const wait = flagNum(p, 'wait')
	const r = await get<InboxResponse>(`/inbox?wait=${wait ?? 0}${flagBool(p, 'peek') ? '&peek=1' : ''}`)
	if (flagBool(p, 'json')) return json(r)
	if (!r.messages.length) {
		info(dim('новых сообщений нет'))
		process.exitCode = wait ? 3 : 0 // 3 = таймаут ожидания (удобно в скриптах)
		return
	}
	const g = await graph()
	const agents = new Map(g.agents.map(a => [a.id, a]))
	for (const m of r.messages) out(formatMessage(m, agents))
}

async function cmdCancel(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch cancel <агент>', 2)
	const a = await post<AgentView>(`/agents/${enc(ref)}/cancel`, {})
	out(flagBool(p, 'json') ? JSON.stringify(a) : `${green('✓')} прервано: ${a.id} (${a.status})`)
}

async function cmdKill(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch kill <агент>', 2)
	await request(ep, 'DELETE', `/agents/${enc(ref)}`)
	out(`${green('✓')} удалён: ${ref}`)
}

async function cmdSpace(p: Parsed): Promise<void> {
	const [sub, ...rest] = p.positionals
	if (sub === 'ls' || sub === undefined) {
		const list = await get<SpaceView[]>('/spaces')
		return flagBool(p, 'json') ? json(list) : out(spacesTable(list))
	}
	if (sub === 'add') {
		const target = rest[0]
		if (!target) throw new CliError('использование: nessy-orch space add <абсолютный путь> [--name N] [--url URL]', 2)
		const s = await post<SpaceView>('/spaces', { path: path.resolve(target), name: flagStr(p, 'name'), url: flagStr(p, 'url') })
		return flagBool(p, 'json') ? json(s) : out(`${green('✓')} пространство ${bold(s.name)} → ${s.path}`)
	}
	if (sub === 'rm') {
		const name = rest[0]
		if (!name) throw new CliError('использование: nessy-orch space rm <имя> [--force]', 2)
		await request(ep, 'DELETE', `/spaces/${enc(name)}${flagBool(p, 'force') ? '?force=1' : ''}`)
		return out(`${green('✓')} удалено: ${name}`)
	}
	throw new CliError(`неизвестная подкоманда space ${sub}`, 2)
}

async function cmdOpen(): Promise<void> {
	const url = `http://127.0.0.1:${ep.port}/`
	out(url)
	const { spawn } = await import('node:child_process')
	spawn('open', [url], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
}

// ======================================================================
// диспетчер
// ======================================================================
type Cmd = { run: (p: Parsed) => Promise<void>; spec: FlagSpec }
const WAIT_FLAGS: FlagSpec = { bool: ['json', 'help', 'wait'], value: ['timeout', 'from', 'space', 'name'], short: { w: 'wait' } }

const COMMANDS: Record<string, Cmd> = {
	status: { run: cmdStatus, spec: COMMON },
	ls: { run: cmdLs, spec: COMMON },
	spawn: { run: cmdSpawn, spec: WAIT_FLAGS },
	send: { run: cmdSend, spec: WAIT_FLAGS },
	ask: { run: cmdAsk, spec: { ...WAIT_FLAGS } },
	show: { run: cmdShow, spec: { bool: ['json', 'help'], value: ['n'] } },
	watch: { run: cmdWatch, spec: COMMON },
	feed: { run: cmdFeed, spec: { bool: ['json', 'help', 'follow'], value: ['n'], short: { f: 'follow' } } },
	inbox: { run: cmdInbox, spec: { bool: ['json', 'help', 'peek'], value: ['wait'] } },
	cancel: { run: cmdCancel, spec: COMMON },
	kill: { run: cmdKill, spec: COMMON },
	space: { run: cmdSpace, spec: { bool: ['json', 'help', 'force'], value: ['name', 'url'] } },
	open: { run: cmdOpen, spec: COMMON },
	install: { run: p => install({ print: flagBool(p, 'print') }), spec: { bool: ['help', 'print'] } },
	uninstall: { run: () => uninstall(), spec: COMMON },
}
// алиасы
const ALIASES: Record<string, string> = { list: 'ls', agents: 'ls', rm: 'kill', log: 'feed', messages: 'feed', spaces: 'space' }

async function main(argv: string[]): Promise<void> {
	const [name, ...rest] = argv
	if (!name || name === 'help' || name === '--help' || name === '-h') return out(HELP)
	const cmd = COMMANDS[ALIASES[name] ?? name]
	if (!cmd) throw new CliError(`неизвестная команда «${name}». См. nessy-orch --help`, 2)
	const p = parseArgs(rest, cmd.spec)
	if (flagBool(p, 'help')) return out(HELP)
	await cmd.run(p)
}

main(process.argv.slice(2)).catch((e: unknown) => {
	info(red('✗ ') + errMsg(e))
	process.exit(e instanceof CliError ? e.exitCode : 1)
})
