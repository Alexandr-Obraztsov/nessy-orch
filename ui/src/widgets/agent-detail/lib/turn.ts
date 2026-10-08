import type { AgentEvent } from '@contract'
import type { Step, TurnView } from '../model/types'

const open = (s: string): boolean => s === 'pending' || s === 'in_progress'

/**
 * Последний ход агента: события после последнего входящего сообщения.
 * Длительность инструмента — из durations (точная, если завершение видели вживую),
 * иначе до следующего события; у идущего шага — до `now`.
 */
export function lastTurn(events: AgentEvent[], durations: Map<string, number>, running: boolean, now: number): TurnView | null {
	let from = -1
	let index = 0
	for (let i = 0; i < events.length; i++) {
		if (events[i]?.kind === 'user') {
			from = i
			index++
		}
	}
	const slice = events.slice(Math.max(0, from))
	const first = slice[0]
	if (!first) return null
	const steps: Step[] = []
	for (let i = 0; i < slice.length; i++) {
		const ev = slice[i]
		if (!ev) continue
		const next = slice[i + 1]
		const tillNext = next ? Math.max(0, next.ts - ev.ts) : null
		if (ev.kind === 'tool') {
			const live = running && open(ev.status)
			const ms = live ? now - ev.ts : (durations.get(ev.toolId) ?? tillNext)
			steps.push({ kind: 'tool', key: `t:${ev.toolId}`, ev, start: ev.ts, ms, running: live })
		} else if (ev.kind === 'permission') {
			const live = !ev.resolved && running
			steps.push({ kind: 'permission', key: `p:${ev.requestId}`, ev, start: ev.ts, ms: live ? now - ev.ts : tillNext, running: live })
		}
	}
	let end = slice[slice.length - 1]?.ts ?? first.ts
	for (const s of steps) if (s.ms !== null) end = Math.max(end, s.start + s.ms)
	if (running) end = Math.max(end, now)
	return { index: Math.max(1, index), start: first.ts, end, running, steps }
}
