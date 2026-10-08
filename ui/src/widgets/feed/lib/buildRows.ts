import type { Message } from '@contract'
import { dayKey, dayLabel } from '@/shared/lib/time'
import type { FeedRow } from '../model/types'

/** окно группировки подряд идущих сообщений одного отправителя */
const GROUP_MS = 3 * 60 * 1000

/**
 * Лента → строки: разделители дней, системные плашки, сообщения с признаками группы.
 * `all` — полный список (для поиска ответов и цитат, даже если отфильтрованы).
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
	let prev: Message | null = null
	for (const m of list) {
		const dk = dayKey(m.ts)
		if (dk !== day) {
			day = dk
			prev = null
			rows.push({ t: 'day', key: `d:${dk}`, label: dayLabel(m.ts) })
		}
		if (m.kind === 'event') {
			rows.push({ t: 'event', key: m.id, msg: m })
			prev = null
			continue
		}
		const first = !prev || prev.from !== m.from || m.ts - prev.ts > GROUP_MS
		const quoteSrc = m.replyTo ? byId.get(m.replyTo) : undefined
		rows.push({
			t: 'msg',
			key: m.id,
			msg: m,
			first,
			route: first || prev?.to !== m.to,
			waiting: !!m.wait && !m.failed && m.kind === 'msg' && !replied.has(m.id),
			quote: quoteSrc ? quoteSrc.text : null,
		})
		prev = m
	}
	return rows
}
