/** Команды ленты и входящих: feed, inbox. */
import type { GraphView, InboxResponse, Message, SettledResponse } from '../../../../shared/types'
import { flagBool, flagNum } from '../args'
import { CliError } from '../errors'
import type { Parsed } from '../args.types'
import { asStreamEvent, sse } from '../client'
import { dim, formatMessage } from '../format'
import { enc, ep, get, info, json, out, post } from '../io'
import type { CommandTable } from './command.types'
import { INBOX_FLAGS } from './flags'
import { sessionOption } from './sessions.commands'

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

/**
 * `inbox --session S --all --wait N`: один раз дождаться, пока агенты сессии закончат (или зададут вопрос), и вывести сводку.
 * Запускается в фоне (Bash run_in_background): Claude Code разбудит Claude по завершении. Курсор сдвигается после вывода сводки.
 * Коды выхода: 0 — сводка (все закончили или вопрос), 3 — время вышло, агенты ещё работают (сводка напечатана, если есть), 4 — ждать нечего,
 * 5 — ожидание этой сессии уже запущено (второе не нужно).
 */
async function awaitDigest(p: Parsed, session: string): Promise<void> {
	const r = await get<SettledResponse>(`/sessions/${enc(session)}/wait?timeout=${flagNum(p, 'wait') ?? 1500}`)
	if (flagBool(p, 'json')) return json(r)
	const d = r.digest
	if (d.count > 0) {
		out(`${d.header}\n\n${d.text}`)
		await post(`/sessions/${enc(session)}/ack`, { cursor: d.cursor })
	}
	if (r.reason === 'watching') {
		// второго ожидания не нужно: первое напечатает общую сводку
		info(dim('ожидание этой сессии уже запущено — второе не нужно'))
		process.exitCode = 5
	} else if (r.reason === 'nothing') {
		info(dim('ждать нечего: в сессии нет работающих агентов и непрочитанных ответов'))
		process.exitCode = 4
	} else if (r.reason === 'timeout') {
		info(dim(`время ожидания вышло, агентов в работе: ${r.active} — запусти ожидание снова`))
		process.exitCode = 3
	}
}

async function cmdInbox(p: Parsed): Promise<void> {
	const wait = flagNum(p, 'wait')
	const session = sessionOption(p)
	if (flagBool(p, 'all')) {
		if (!session) throw new CliError('--all требует сессию: --session S (или NESSY_ORCH_SESSION)', 2)
		return awaitDigest(p, session)
	}
	const r = await get<InboxResponse>(`/inbox?wait=${wait ?? 0}${flagBool(p, 'peek') ? '&peek=1' : ''}${session ? `&session=${enc(session)}` : ''}`)
	if (flagBool(p, 'json')) return json(r)
	if (!r.messages.length) {
		if (r.active === 0) {
			// ждать некого: никто не работает и ответов нет — возврат сразу, а не зависание на весь --wait
			info(dim(`ждать нечего: ${session ? 'в сессии' : 'в оркестраторе'} нет работающих агентов и непрочитанных ответов (запустите агента: spawn / send)`))
			process.exitCode = wait ? 4 : 0 // 4 = нет работающих агентов
		} else {
			info(dim(`новых сообщений нет, агентов в работе: ${r.active}`))
			process.exitCode = wait ? 3 : 0 // 3 = таймаут ожидания: агенты ещё работают — запустить inbox снова
		}
		return
	}
	const g = await get<GraphView>('/graph')
	const agents = new Map(g.agents.map(a => [a.id, a]))
	for (const m of r.messages) out(formatMessage(m, agents))
}

export const feedCommands: CommandTable = {
	feed: { run: cmdFeed, spec: { bool: ['json', 'help', 'follow'], value: ['n'], short: { f: 'follow' } } },
	inbox: { run: cmdInbox, spec: INBOX_FLAGS },
}
