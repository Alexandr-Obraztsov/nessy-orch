/** Команды агентов: spawn, send, ask, ls, show, watch, plan, cancel, archive, restore, kill. */
import * as path from 'node:path'
import type { AgentEvent, AgentView, GraphView, SendResponse, SpawnResponse } from '../../../../shared/types'
import { parsePlanArgs } from '../../../domain/plan'
import { flagBool, flagNum, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { asAgentStreamEvent, sse } from '../client'
import { CliError } from '../errors'
import { agentsTable, bold, dim, green, planText, red, status, time } from '../format'
import { del, enc, ep, get, info, json, out, post } from '../io'
import { renderEvent } from '../render-event'
import type { CommandTable } from './command.types'
import { ASK_FLAGS, COMMON, LS_FLAGS, PLAN_FLAGS, SEND_FLAGS, SPAWN_FLAGS } from './flags'
import { taskOption } from './tasks.commands'

/** Пространство задают именем или путём; относительный путь считаем от текущего каталога CLI, а не сервера. */
function spaceArg(v: string | undefined): string | undefined {
	if (v === undefined) return undefined
	return v.startsWith('.') || v.includes('/') ? path.resolve(v) : v
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
		const task = agent?.task ? ` --task ${agent.task}` : ''
		info(dim(`отправлено ${r.message.id} → ${r.message.to}. Ответ придёт в inbox: nessy-orch inbox${task} --wait 60`))
	}
}

async function cmdLs(p: Parsed): Promise<void> {
	const g = await get<GraphView>('/graph')
	const task = taskOption(p)
	if (task !== undefined && !g.tasks.some(t => t.id === task)) throw new CliError(`задача «${task}» не найдена [no_task]`)
	const scope = task === undefined ? g.agents : g.agents.filter(a => a.task === task)
	const list = flagBool(p, 'all') ? scope : scope.filter(a => !a.archived)
	if (flagBool(p, 'json')) return json(list)
	out(agentsTable(list, g.spaces, g.roles, scope.length - list.length))
}

async function cmdSpawn(p: Parsed): Promise<void> {
	const prompt = p.positionals.join(' ').trim()
	const wait = flagBool(p, 'wait')
	if (wait && !prompt) throw new CliError('--wait требует текст задачи', 2)
	const r = await post<SpawnResponse>('/agents', {
		space: spaceArg(flagStr(p, 'space')),
		name: flagStr(p, 'name'),
		role: flagStr(p, 'role'),
		task: taskOption(p),
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
	if (!to || !text) throw new CliError('использование: nessy-orch send <агент|you> "текст" [--wait] [--queue] [--from ID]', 2)
	const r = await post<SendResponse>(`/agents/${enc(to)}/send`, {
		text,
		from: flagStr(p, 'from'),
		// по умолчанию сообщение от you прерывает текущий ход; --queue — встать в очередь
		interrupt: flagBool(p, 'queue') ? false : undefined,
		wait: flagBool(p, 'wait'),
		waitTimeoutSec: flagNum(p, 'timeout'),
	})
	printSendResult(p, null, r)
}

async function cmdAsk(p: Parsed): Promise<void> {
	const [space, ...rest] = p.positionals
	const prompt = rest.join(' ').trim()
	if (!space || !prompt) throw new CliError('использование: nessy-orch ask <путь|пространство> "задача"', 2)
	const r = await post<SpawnResponse>('/agents', {
		space: spaceArg(space),
		task: taskOption(p),
		prompt,
		wait: true,
		waitTimeoutSec: flagNum(p, 'timeout'),
	})
	printSendResult(p, r.agent, r)
}

async function cmdShow(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch show <агент>', 2)
	const [a, ev] = await Promise.all([
		get<AgentView>(`/agents/${enc(ref)}`),
		get<AgentEvent[]>(`/agents/${enc(ref)}/history?limit=${flagNum(p, 'n') ?? 40}`),
	])
	if (flagBool(p, 'json')) return json({ agent: a, events: ev })
	const tags = [a.task ? `задача ${a.task}` : '', a.role ? `роль ${a.role}` : '', a.archived ? 'в архиве' : ''].filter(Boolean).join(', ')
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
