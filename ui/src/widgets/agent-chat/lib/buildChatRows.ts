import type { AgentEvent } from '@contract'
import type { LiveRun } from '@/entities/agent'
import { dayKey, dayLabel } from '@/shared/lib/time'
import type { ChatRow } from '../model/types'

type Side = 'you' | 'other' | 'agent' | 'center'

function side(e: AgentEvent): Side {
	if (e.kind === 'user') return e.from === 'you' ? 'you' : 'other'
	if (e.kind === 'system') return 'center'
	return 'agent'
}

/** События агента + незавершённые блоки → строки чата с разделителями дней. */
export function buildChatRows(events: AgentEvent[], live: LiveRun[]): ChatRow[] {
	const rows: ChatRow[] = []
	let day = ''
	let prev: Side | null = null
	let prevFrom = ''
	const push = (ts: number): void => {
		const dk = dayKey(ts)
		if (dk !== day) {
			day = dk
			prev = null
			rows.push({ t: 'day', key: `d:${dk}`, label: dayLabel(ts) })
		}
	}
	for (const ev of events) {
		push(ev.ts)
		const sd = side(ev)
		const from = ev.kind === 'user' ? ev.from : ''
		rows.push({ t: 'event', key: `e:${ev.seq}`, ev, first: sd !== prev || from !== prevFrom })
		prev = sd
		prevFrom = from
	}
	for (const run of live) {
		push(run.ts)
		rows.push({ t: 'live', key: `l:${run.seq}`, run, first: prev !== 'agent' })
		prev = 'agent'
	}
	return rows
}
