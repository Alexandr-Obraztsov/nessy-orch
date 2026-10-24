/**
 * Команда ленты: feed — общая лента сообщений, опционально живой поток (--follow).
 * События SSE выводятся человеку через renderStreamEvent.
 */
import type { GraphView, Message } from '../../../../shared/types'
import { flagBool, flagNum } from '../args'
import { asStreamEvent } from '../client'
import { formatMessage } from '../format'
import type { Ctx } from '../ctx'
import { FEED_FLAGS } from '../flags'
import { renderStreamEvent } from '../render-event'
import type { CommandTable } from './command.types'

async function cmdFeed(c: Ctx): Promise<void> {
	const { p, t } = c
	const g = await t.get<GraphView>('/graph')
	const agents = new Map(g.agents.map(a => [a.id, a]))
	const n = flagNum(p, 'n') ?? 30
	const asJson = flagBool(p, 'json')
	const follow = flagBool(p, 'follow')
	const list = await t.get<Message[]>(`/messages?limit=${n}`)
	if (asJson && !follow) return c.json(list)
	for (const m of list) c.out(asJson ? JSON.stringify(m) : formatMessage(m, agents))
	if (!follow) return
	const stream = t.sse('/stream', raw => {
		const ev = asStreamEvent(raw)
		if (!ev) return
		c.out(asJson ? JSON.stringify(ev) : renderStreamEvent(ev))
	})
	process.on('SIGINT', () => {
		stream.close()
		process.exit(0)
	})
	await stream.done
}

export const feedCommands: CommandTable = {
	feed: { run: cmdFeed, spec: FEED_FLAGS },
}
