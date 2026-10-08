import type { AgentView } from '@contract'
import type { Attention, DetailTab } from '../model/types'

const busy = (a: AgentView): boolean => a.status === 'working' || a.status === 'starting'

/** Что ждёт оператора: разрешение → ошибка → новый (непросмотренный) результат. */
export function attentionOf(agent: AgentView, seen: (msgId: string) => boolean): Attention | null {
	const perm = agent.pendingPermissions[0]
	if (perm) return { kind: 'permission', requestId: perm.requestId, title: perm.title, more: agent.pendingPermissions.length - 1 }
	if (agent.status === 'error') return { kind: 'error', text: agent.error ?? agent.lastReply?.failed ?? 'Ход завершился ошибкой' }
	const r = agent.lastReply
	if (r && !r.failed && !busy(agent) && !seen(r.msgId)) return { kind: 'result', msgId: r.msgId, preview: r.preview }
	return null
}

/** Вкладка по умолчанию: «Шаги», пока агент работает; «Результат», если он есть; иначе «Чат». */
export function defaultTab(agent: AgentView): DetailTab {
	if (busy(agent)) return 'steps'
	if (agent.lastReply) return 'result'
	return 'chat'
}
