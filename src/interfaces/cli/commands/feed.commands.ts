/** Команды ленты: feed. */
import type { GraphView, Message } from '../../../../shared/types'
import { flagBool, flagNum } from '../args'
import type { Parsed } from '../args.types'
import { asStreamEvent, sse } from '../client'
import { formatMessage } from '../format'
import { ep, get, json, out } from '../io'
import type { CommandTable } from './command.types'

async function cmdFeed(p: Parsed): Promise<void> {
	const g = await get<GraphView>('/graph')
	const agents = new Map(g.agents.map(a => [a.id, a]))
	const n = flagNum(p, 'n') ?? 30
	const asJson = flagBool(p, 'json')
	const follow = flagBool(p, 'follow')
	const list = await get<Message[]>(`/messages?limit=${n}`)
	if (asJson && !follow) return json(list)
	for (const m of list) out(asJson ? JSON.stringify(m) : formatMessage(m, agents))
	if (!follow) return
	const stream = sse(ep, '/stream', raw => {
		const ev = asStreamEvent(raw)
		if (!ev) return
		if (ev.t === 'agent') agents.set(ev.agent.id, ev.agent)
		else if (ev.t === 'message') out(asJson ? JSON.stringify(ev.message) : formatMessage(ev.message, agents))
	})
	process.on('SIGINT', () => {
		stream.close()
		process.exit(0)
	})
	await stream.done
}

export const feedCommands: CommandTable = {
	feed: { run: cmdFeed, spec: { bool: ['json', 'help', 'follow'], value: ['n'], short: { f: 'follow' } } },
}
