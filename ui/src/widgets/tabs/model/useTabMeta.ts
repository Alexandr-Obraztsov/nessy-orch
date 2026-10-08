import { agentStatusMeta } from '@/entities/agent'
import { type State, type Tab, useStore } from '@/shared/model'
import type { TabMeta } from './types'

export const tabKey = (t: Tab): string => (t.kind === 'agent' || t.kind === 'role' ? `${t.kind}:${t.id ?? 'new'}` : t.kind)

/** Описание вкладки по текущему состоянию стора (без хуков — для списков). */
export function tabMeta(t: Tab, st: Pick<State, 'agents' | 'roles'>): TabMeta {
	const key = tabKey(t)
	switch (t.kind) {
		case 'feed':
			return { key, title: 'Лента', icon: 'feed', status: null, roleHue: null, closable: false }
		case 'graph':
			return { key, title: 'Граф', icon: 'graph', status: null, roleHue: null, closable: true }
		case 'agent': {
			const a = st.agents.find(x => x.id === t.id)
			return { key, title: a?.name ?? t.id, icon: 'bot', status: a ? agentStatusMeta(a) : null, roleHue: null, closable: true }
		}
		case 'role': {
			const r = t.id ? st.roles.find(x => x.id === t.id) : undefined
			return { key, title: r?.name ?? (t.id ? t.id : 'Новая роль'), icon: 'tag', status: null, roleHue: r?.color ?? null, closable: true }
		}
	}
}

/** Реактивное описание вкладки. */
export function useTabMeta(t: Tab): TabMeta {
	const agents = useStore(s => s.agents)
	const roles = useStore(s => s.roles)
	return tabMeta(t, { agents, roles })
}
