/**
 * Живой чат одного агента: SSE `/agents/:id/stream` (история → replay_done → живые события).
 * chunk-события копятся в `live` до прихода финального события с тем же seq.
 */
import { useEffect, useState } from 'react'
import type { AgentEvent, AgentStreamEvent } from '@contract'
import { apiUrl } from '@/shared/lib/desktop'
import type { AgentStreamState, LiveRun } from './types'

const EMPTY: AgentStreamState = { events: [], live: [], agent: null, ready: false, connected: false }
const MAX_EVENTS = 1500

function upsertEvent(list: AgentEvent[], e: AgentEvent): AgentEvent[] {
	const last = list[list.length - 1]
	if (!last || e.seq > last.seq) return [...list, e].slice(-MAX_EVENTS)
	const i = list.findIndex(x => x.seq === e.seq)
	if (i !== -1) {
		const next = list.slice()
		next[i] = e
		return next
	}
	return [...list, e].sort((a, b) => a.seq - b.seq)
}

function reduce(s: AgentStreamState, m: AgentStreamEvent): AgentStreamState {
	switch (m.t) {
		case 'event':
			return {
				...s,
				events: upsertEvent(s.events, m.event),
				live: s.live.filter(r => r.seq !== m.event.seq),
			}
		case 'chunk': {
			const c = m.chunk
			const cur = s.live.find(r => r.seq === c.seq)
			let text: string
			if (!cur) text = c.delta
			else if (cur.text.length + c.delta.length === c.len) text = cur.text + c.delta
			else if (c.delta.length === c.len) text = c.delta // полный снимок блока
			else text = cur.text + c.delta
			const run: LiveRun = { seq: c.seq, ts: c.ts, kind: c.kind, text }
			return { ...s, live: [...s.live.filter(r => r.seq !== c.seq), run].sort((a, b) => a.seq - b.seq) }
		}
		case 'agent':
			return { ...s, agent: m.agent }
		case 'replay_done':
			return { ...s, ready: true }
	}
}

export function useAgentStream(id: string | null): AgentStreamState {
	const [state, setState] = useState<AgentStreamState>(EMPTY)

	useEffect(() => {
		setState(EMPTY)
		if (!id) return
		let closed = false
		let es: EventSource | null = null
		let timer: number | undefined
		let attempt = 0

		const open = (): void => {
			es = new EventSource(apiUrl(`/agents/${encodeURIComponent(id)}/stream`))
			es.onopen = () => {
				attempt = 0
				// сервер заново проигрывает историю — начинаем с чистого листа
				setState({ ...EMPTY, connected: true })
			}
			es.onmessage = e => {
				let m: AgentStreamEvent
				try {
					m = JSON.parse(String(e.data)) as AgentStreamEvent
				} catch {
					return
				}
				setState(s => reduce(s, m))
			}
			es.onerror = () => {
				es?.close()
				setState(s => ({ ...s, connected: false }))
				if (closed) return
				timer = window.setTimeout(open, Math.min(10000, 500 * 2 ** attempt++))
			}
		}
		open()
		return () => {
			closed = true
			window.clearTimeout(timer)
			es?.close()
		}
	}, [id])

	return state
}
