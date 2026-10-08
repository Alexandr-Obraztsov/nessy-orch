/**
 * Длительности вызовов инструментов. Сервер хранит только время начала, поэтому:
 * завершение, увиденное вживую, — точное (момент смены статуса); для истории — приблизительно,
 * до следующего события агента.
 */
import { useRef } from 'react'
import type { AgentEvent } from '@contract'

const done = (s: string): boolean => s === 'completed' || s === 'failed'

export function useToolDurations(events: AgentEvent[], ready: boolean): Map<string, number> {
	const seenOpen = useRef(new Set<string>())
	const finished = useRef(new Map<string, number>())
	const out = new Map<string, number>()
	for (let i = 0; i < events.length; i++) {
		const ev = events[i]
		if (!ev || ev.kind !== 'tool') continue
		if (!done(ev.status)) {
			if (ready) seenOpen.current.add(ev.toolId)
			continue
		}
		if (seenOpen.current.has(ev.toolId) && !finished.current.has(ev.toolId)) finished.current.set(ev.toolId, Date.now())
		const end = finished.current.get(ev.toolId) ?? events[i + 1]?.ts
		if (end !== undefined && end >= ev.ts) out.set(ev.toolId, end - ev.ts)
	}
	return out
}
