/** Команды агентов: spawn, send, ask, ls, show, watch, cancel, kill. */
import type { AgentEvent, AgentView, GraphView, SendResponse, SpawnResponse } from '../../../../shared/types'
import { flagBool, flagNum, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { asAgentStreamEvent, sse } from '../client'
import { CliError } from '../errors'
import { agentsTable, bold, dim, green, red, status, time } from '../format'
import { del, enc, ep, get, info, json, out, post } from '../io'
import { renderEvent } from '../render-event'
import type { CommandTable } from './command.types'
import { COMMON, WAIT_FLAGS } from './flags'

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

async function cmdLs(p: Parsed): Promise<void> {
	const g = await get<GraphView>('/graph')
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
	const [a, ev] = await Promise.all([
		get<AgentView>(`/agents/${enc(ref)}`),
		get<AgentEvent[]>(`/agents/${enc(ref)}/history?limit=${flagNum(p, 'n') ?? 40}`),
	])
	if (flagBool(p, 'json')) return json({ agent: a, events: ev })
	out(`${bold(a.id)} ${a.name !== a.id ? `(${a.name}) ` : ''}${status(a.status)}  ${a.space}${a.displayName ? `  «${a.displayName}»` : ''}`)
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

async function cmdCancel(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch cancel <агент>', 2)
	const a = await post<AgentView>(`/agents/${enc(ref)}/cancel`, {})
	out(flagBool(p, 'json') ? JSON.stringify(a) : `${green('✓')} прервано: ${a.id} (${a.status})`)
}

async function cmdKill(p: Parsed): Promise<void> {
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch kill <агент>', 2)
	await del(`/agents/${enc(ref)}`)
	out(`${green('✓')} удалён: ${ref}`)
}

export const agentCommands: CommandTable = {
	ls: { run: cmdLs, spec: COMMON },
	spawn: { run: cmdSpawn, spec: WAIT_FLAGS },
	send: { run: cmdSend, spec: WAIT_FLAGS },
	ask: { run: cmdAsk, spec: WAIT_FLAGS },
	show: { run: cmdShow, spec: { bool: ['json', 'help'], value: ['n'] } },
	watch: { run: cmdWatch, spec: COMMON },
	cancel: { run: cmdCancel, spec: COMMON },
	kill: { run: cmdKill, spec: COMMON },
}
