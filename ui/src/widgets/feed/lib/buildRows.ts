import type { Message } from '@contract'
import { dayKey, dayLabel } from '@/shared/lib/time'
import type { FeedRow } from '../model/types'

/**
 * Лента → строки: разделители дней, системные события, ваши сообщения, сообщения агентов.
 * `all` — полный список (ответы и цитаты ищем и среди скрытых).
 */
export function buildRows(list: Message[], all: Message[]): FeedRow[] {
	const replied = new Set<string>()
	const byId = new Map<string, Message>()
	for (const m of all) {
		byId.set(m.id, m)
		if (m.replyTo) replied.add(m.replyTo)
	}
	const rows: FeedRow[] = []
	let day = ''
	for (const m of list) {
		const dk = dayKey(m.ts)
		if (dk !== day) {
			day = dk
			rows.push({ t: 'day', key: `d:${dk}`, label: dayLabel(m.ts) })
		}
		if (m.kind === 'event') rows.push({ t: 'event', key: m.id, msg: m })
		else if (m.from === 'you') rows.push({ t: 'mine', key: m.id, msg: m, answered: replied.has(m.id) })
		else rows.push({ t: 'agent', key: m.id, msg: m, quote: (m.replyTo && byId.get(m.replyTo)) || null })
	}
	return rows
}
