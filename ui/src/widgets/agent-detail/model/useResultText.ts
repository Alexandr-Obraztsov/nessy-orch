import { useMemo } from 'react'
import type { AgentEvent, AgentView } from '@contract'
import { useStore } from '@/shared/model'

/**
 * Текст последнего ответа агента оператору: по lastReply.msgId из общей ленты;
 * если ленты нет под рукой — текстовые блоки последнего завершённого хода из событий агента.
 */
export function useResultText(agent: AgentView, events: AgentEvent[]): string | null {
	const msgId = agent.lastReply?.msgId ?? null
	const fromFeed = useStore(st => (msgId ? (st.messages.find(m => m.id === msgId)?.text ?? null) : null))
	return useMemo(() => {
		const r = agent.lastReply
		if (!r) return null
		if (fromFeed !== null) return fromFeed
		// запасной путь: текст ответа = текстовые события после последнего входящего сообщения до lastReply.ts
		let from = 0
		for (let i = events.length - 1; i >= 0; i--) {
			const ev = events[i]
			if (ev?.kind === 'user' && ev.ts <= r.ts) {
				from = i + 1
				break
			}
		}
		const parts = events.slice(from).flatMap(ev => (ev.kind === 'text' && ev.ts <= r.ts + 1000 ? [ev.text] : []))
		return parts.length > 0 ? parts.join('\n\n') : r.preview || null
	}, [agent.lastReply, fromFeed, events])
}
