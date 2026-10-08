import { useCallback } from 'react'
import type { AgentEvent, AgentView } from '@contract'
import { api, errorText } from '@/shared/api'
import { YOU, getState } from '@/shared/model'
import { toast } from '@/shared/ui'

/** Последнее сообщение оператора агенту: из событий агента, иначе из общей ленты. */
function lastFromYou(agentId: string, events: AgentEvent[]): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i]
		if (ev?.kind === 'user' && ev.from === YOU) return ev.text
	}
	const msgs = getState().messages
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i]
		if (m && m.from === YOU && m.to === agentId && m.kind === 'msg') return m.text
	}
	return null
}

/** «Повторить»: отправить агенту ваше последнее сообщение ещё раз. */
export function useRetry(agent: AgentView, events: AgentEvent[]): () => Promise<void> {
	return useCallback(async () => {
		const text = lastFromYou(agent.id, events)
		if (!text) {
			toast('Нечего повторять: вы ещё не писали этому агенту', 'error')
			return
		}
		try {
			await api.send(agent.id, { text, from: YOU })
			toast('Сообщение отправлено повторно', 'success', 2000)
		} catch (e) {
			toast(`Не отправлено: ${errorText(e)}`, 'error')
		}
	}, [agent.id, events])
}
