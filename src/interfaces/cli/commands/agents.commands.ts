/** Команды агентов: spawn, send, ask, ls, show, watch, plan, cancel, archive, restore, kill. */
import * as path from 'node:path'
import type { AgentEvent, AgentView, GraphView, SendResponse, SpawnResponse, WaitResponse } from '../../../../shared/types'
import { parsePlanArgs } from '../../../domain/plan'
import { flagBool, flagNum, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { asAgentStreamEvent, sse } from '../client'
import { CliError } from '../errors'
import { agentsTable, bold, dim, green, planText, red, status, time } from '../format'
import { del, enc, ep, get, info, json, out, post } from '../io'
import { renderEvent } from '../render-event'
import type { CommandTable } from './command.types'
import { ASK_FLAGS, COMMON, LS_FLAGS, PLAN_FLAGS, SEND_FLAGS, SPAWN_FLAGS, WAIT_CMD_FLAGS } from './flags'
import { sessionOption } from './sessions.commands'

/** Сколько ждём результат по умолчанию, секунд (по истечении — код 3 и подсказка `wait`). */
const DEFAULT_WAIT_SEC = 1500

/**
 * Ждать ли результата: оператор (Claude) по умолчанию ждёт, а запущенная им команда живёт в фоне и будит Claude по завершении.
 * `--no-wait` — отправить и вернуться. Агент (`--from`) по умолчанию не ждёт: ответ придёт ему сообщением; `--wait` — ждать.
 */
function waits(p: Parsed): boolean {
	if (flagBool(p, 'no-wait')) return false
	return flagBool(p, 'wait') || flagStr(p, 'from') === undefined
}

/** Пространство задают именем или путём; относительный путь считаем от текущего каталога CLI, а не сервера. */
function spaceArg(v: string | undefined): string | undefined {
	if (v === undefined) return undefined
	return v.startsWith('.') || v.includes('/') ? path.resolve(v) : v
}

/** Общий вывод для spawn/send: ответ — в stdout, служебное — в stderr. */
function printSendResult(p: Parsed, agent: AgentView | null, r: SendResponse): void {
	if (flagBool(p, 'json')) return json(agent ? { agent, ...r } : r)
	// имя назначает оркестратор: оно нужно, чтобы потом написать агенту (`send <имя>`), поэтому выводим его на видном месте, вместе с результатом
	if (agent) info(`${green('✓')} агент ${bold(agent.name)}${agent.title ? ` «${agent.title}»` : ''} (id ${agent.id}) в «${agent.space}»`)
	if (r.reply) {
		if (r.reply.failed) info(red(`агент ответил с ошибкой: ${r.reply.failed}`))
		out(r.reply.text)
	} else if (r.timedOut) {
		throw new CliError(`ответ не получен за отведённое время; агент продолжает работу. Дождаться снова (в фоне): nessy-orch wait ${agent?.id ?? r.message.to}`, 3)
	} else {
		if (r.started && !agent) info(dim('агент был свободен — сообщение запустило его в работу'))
		else if (r.interrupted) info(dim('агент работал — его ход прерван этим сообщением (--interrupt)'))
		else if (r.queued) info(dim('агент работает — сообщение доставлено в идущий ход (или встанет в очередь), ход не прерван'))
		info(dim(`отправлено ${r.message.id} → ${r.message.to}. Результат: nessy-orch wait ${agent?.id ?? r.message.to} (в фоне)`))
	}
}

async function cmdLs(p: Parsed): Promise<void> {
	const g = await get<GraphView>('/graph')
	const session = sessionOption(p)
	if (session !== undefined && !g.sessions.some(t => t.id === session)) throw new CliError(`сессия «${session}» не найдена [no_session]`)
	const scope = session === undefined ? g.agents : g.agents.filter(a => a.session === session)
	const list = flagBool(p, 'all') ? scope : scope.filter(a => !a.archived)
	if (flagBool(p, 'json')) return json(list)
	out(agentsTable(list, g.spaces, g.roles, scope.length - list.length))
}

async function cmdSpawn(p: Parsed): Promise<void> {
	const prompt = p.positionals.join(' ').trim()
	const wait = waits(p) && prompt !== ''
	if (flagBool(p, 'wait') && !prompt) throw new CliError('--wait требует текст поручения', 2)
	const r = await post<SpawnResponse>('/agents', {
		space: spaceArg(flagStr(p, 'space')),
		cwd: process.cwd(), // пространство по умолчанию, если --space не указан и пространств не одно
		title: flagStr(p, 'title'),
		role: flagStr(p, 'role'),
		session: sessionOption(p),
		from: flagStr(p, 'from'),
		prompt: prompt || undefined,
		wait,
		waitTimeoutSec: flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC,
	})
	printSendResult(p, r.agent, r)
}

async function cmdSend(p: Parsed): Promise<void> {
	const [to, ...rest] = p.positionals
	const text = rest.join(' ').trim()
	if (!to || !text) throw new CliError('использование: nessy-orch send <агент|you> "текст" [--no-wait] [--interrupt] [--from ID]', 2)
	const r = await post<SendResponse>(`/agents/${enc(to)}/send`, {
		text,
		from: flagStr(p, 'from'),
		// работающего агента сообщение не прерывает (доставляется в идущий ход); --interrupt — прервать и доставить первым
		interrupt: flagBool(p, 'interrupt') ? true : undefined,
		wait: to !== 'you' && waits(p),
		waitTimeoutSec: flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC,
	})
	printSendResult(p, null, r)
}

async function cmdAsk(p: Parsed): Promise<void> {
	const [space, ...rest] = p.positionals
	const prompt = rest.join(' ').trim()
	if (!space || !prompt) throw new CliError('использование: nessy-orch ask <путь|пространство> "поручение"', 2)
	const r = await post<SpawnResponse>('/agents', {
		space: spaceArg(space),
		session: sessionOption(p),
		prompt,
		wait: true,
		waitTimeoutSec: flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC,
	})
	printSendResult(p, r.agent, r)
}

/** `wait <агент>`: дождаться, пока агент освободится, и вывести его последний ответ (в фоне: Claude Code разбудит по завершении). */
async function cmdWait(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch wait <агент> [--timeout СЕК]', 2)
	const r = await get<WaitResponse>(`/agents/${enc(ref)}/wait?timeout=${flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC}`)
	if (flagBool(p, 'json')) return json(r)
	if (!r.done) throw new CliError(`агент ${r.agent.name} ещё работает; дождаться снова (в фоне): nessy-orch wait ${ref}`, 3)
	if (!r.reply) return info(dim(`агент ${r.agent.name} свободен и ничего не отвечал`))
	if (r.reply.failed) info(red(`агент ответил с ошибкой: ${r.reply.failed}`))
	out(r.reply.text)
}

async function cmdShow(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch show <агент>', 2)
	const [a, ev] = await Promise.all([
		get<AgentView>(`/agents/${enc(ref)}`),
		get<AgentEvent[]>(`/agents/${enc(ref)}/history?limit=${flagNum(p, 'n') ?? 40}`),
	])
	if (flagBool(p, 'json')) return json({ agent: a, events: ev })
	const tags = [a.session ? `сессия ${a.session}` : '', a.role ? `роль ${a.role}` : '', a.archived ? 'в архиве' : ''].filter(Boolean).join(', ')
	out(`${bold(a.id)} ${a.name !== a.id ? `(${a.name}) ` : ''}${status(a.status)}${tags ? dim(` [${tags}]`) : ''}  ${a.space}${a.displayName ? `  «${a.displayName}»` : ''}`)
	for (const e of ev) out(renderEvent(e))
}

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
			if (e.kind === 'tool' && e.output && (e.status === 'completed' || e.status === 'failed')) {
				out(`${dim(time(e.ts))} ${bold((e.status === 'failed' ? '✖ ' : '✔ ') + e.name)} ${dim(e.output.replace(/\s+/g, ' ').slice(0, 160))}`)
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

const PLAN_USAGE = 'использование: nessy-orch plan --from <твой id> "- [x] шаг" "- [~] шаг" "- [ ] шаг" | plan <агент> [--clear]'

/**
 * План агента. С --from — агент публикует свой план (каждый аргумент — пункт чек-листа, список целиком);
 * --clear — убрать план; без пунктов — показать текущий план.
 */
async function cmdPlan(p: Parsed): Promise<void> {
	const from = flagStr(p, 'from')
	const args = [...p.positionals]
	const ref = from ?? args.shift()
	if (!ref) throw new CliError(PLAN_USAGE, 2)
	let a: AgentView
	if (flagBool(p, 'clear')) {
		if (args.length) throw new CliError('--clear не сочетается с пунктами плана', 2)
		await del(`/agents/${enc(ref)}/plan${from ? `?from=${enc(from)}` : ''}`)
		a = await get<AgentView>(`/agents/${enc(ref)}`)
	} else if (args.length) {
		a = await post<AgentView>(`/agents/${enc(ref)}/plan`, { from, entries: parsePlanArgs(args) })
	} else {
		a = await get<AgentView>(`/agents/${enc(ref)}`)
	}
	if (flagBool(p, 'json')) return json(a.plan)
	out(a.plan ? planText(a.plan) : dim(`у агента ${a.id} нет плана`))
}

async function cmdCancel(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch cancel <агент>', 2)
	const a = await post<AgentView>(`/agents/${enc(ref)}/cancel`, {})
	out(flagBool(p, 'json') ? JSON.stringify(a) : `${green('✓')} прервано: ${a.id} (${a.status})`)
}

async function cmdArchive(p: Parsed, action: 'archive' | 'restore'): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError(`использование: nessy-orch ${action} <агент>`, 2)
	const a = await post<AgentView>(`/agents/${enc(ref)}/${action}`, {})
	if (flagBool(p, 'json')) return json(a)
	out(`${green('✓')} ${action === 'archive' ? 'в архиве' : 'возвращён из архива'}: ${a.id}${a.name !== a.id ? ` (${a.name})` : ''}`)
}

async function cmdKill(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch kill <агент>', 2)
	await del(`/agents/${enc(ref)}`)
	out(`${green('✓')} удалён: ${ref}`)
}

export const agentCommands: CommandTable = {
	ls: { run: cmdLs, spec: LS_FLAGS },
	spawn: { run: cmdSpawn, spec: SPAWN_FLAGS },
	wait: { run: cmdWait, spec: WAIT_CMD_FLAGS },
	send: { run: cmdSend, spec: SEND_FLAGS },
	ask: { run: cmdAsk, spec: ASK_FLAGS },
	show: { run: cmdShow, spec: { bool: ['json', 'help'], value: ['n'] } },
	watch: { run: cmdWatch, spec: COMMON },
	plan: { run: cmdPlan, spec: PLAN_FLAGS },
	cancel: { run: cmdCancel, spec: COMMON },
	archive: { run: p => cmdArchive(p, 'archive'), spec: COMMON },
	restore: { run: p => cmdArchive(p, 'restore'), spec: COMMON },
	kill: { run: cmdKill, spec: COMMON },
}
