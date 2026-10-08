import type { AgentEvent } from '@contract'
import type { LiveRun } from '@/entities/agent'
import { dayKey, dayLabel } from '@/shared/lib/time'
import type { ChatRow } from '../model/types'

/** События агента + незавершённые блоки → строки чата с разделителями дней. */
export function buildChatRows(events: AgentEvent[], live: LiveRun[]): ChatRow[] {
	const rows: ChatRow[] = []
	let day = ''
	const push = (ts: number): void => {
		const dk = dayKey(ts)
		if (dk === day) return
		day = dk
		rows.push({ t: 'day', key: `d:${dk}`, label: dayLabel(ts) })
	}
	for (const ev of events) {
		push(ev.ts)
		rows.push({ t: 'event', key: `e:${ev.seq}`, ev })
	}
	for (const run of live) {
		push(run.ts)
		rows.push({ t: 'live', key: `l:${run.seq}`, run })
	}
	return rows
}
