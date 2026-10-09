/**
 * Лента окна агента из событий потока: первое входящее сообщение — поручение (блок сверху),
 * дальше по порядку реплики, мысли, инструменты, разрешения, служебные строки и стриминг.
 */
import type { AgentEvent } from '@contract'
import type { LiveRun } from '@/entities/agent'
import type { ChatItem } from '../model/types'

export function buildItems(events: AgentEvent[], live: LiveRun[]): ChatItem[] {
	const out: ChatItem[] = []
	let briefSeen = false
	for (const ev of events) {
		const key = `${ev.kind}:${ev.seq}`
		switch (ev.kind) {
			case 'user':
				out.push(briefSeen ? { kind: 'user', key, ev } : { kind: 'brief', key, ev })
				briefSeen = true
				break
			case 'text':
				if (ev.text.trim()) out.push({ kind: 'text', key, ev })
				break
			case 'thought':
				if (ev.text.trim()) out.push({ kind: 'thought', key, ev })
				break
			case 'tool':
				out.push({ kind: 'tool', key: `tool:${ev.toolId}`, ev })
				break
			case 'permission':
				out.push({ kind: 'permission', key: `perm:${ev.requestId}`, ev })
				break
			case 'system':
				out.push({ kind: 'system', key, ev })
				break
		}
	}
	for (const run of live) if (run.text) out.push({ kind: 'live', key: `live:${run.seq}`, run })
	return out
}
