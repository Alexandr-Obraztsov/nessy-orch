import type { AgentView } from '@contract'
import { useStore } from '@/shared/model'

/** Полный текст последнего ответа агента из общей ленты (null — ответа нет или он уже вне ленты). */
export function useReplyText(agent: Pick<AgentView, 'lastReply'>): string | null {
	const msgId = agent.lastReply?.msgId ?? null
	return useStore(st => (msgId ? (st.messages.find(m => m.id === msgId)?.text ?? null) : null))
}
