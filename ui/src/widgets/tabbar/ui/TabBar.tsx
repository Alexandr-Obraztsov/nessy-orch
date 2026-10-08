/**
 * Нижние вкладки (< 900px): Граф / Агенты / Лента / Чат. Индикатор плавно переезжает
 * к активной вкладке; бейджи — работающие агенты и непрочитанное в ленте.
 */
import { AgentAvatar } from '@/entities/agent'
import { setMobileTab, spaceHue, useStore, useView } from '@/shared/model'
import { Icon } from '@/shared/ui'
import type { TabDef } from '../model/types'
import { useFeedUnread } from '../model/useFeedUnread'
import { cssVars } from '@/shared/lib/style'
import s from './TabBar.module.css'

const TABS: TabDef[] = [
	{ id: 'graph', label: 'Граф', icon: 'graph' },
	{ id: 'agents', label: 'Агенты', icon: 'users' },
	{ id: 'feed', label: 'Лента', icon: 'feed' },
	{ id: 'chat', label: 'Чат', icon: 'chat' },
]

export function TabBar() {
	const tab = useView(v => v.mobileTab)
	const selectedId = useView(v => v.selectedAgentId)
	const agent = useStore(st => (selectedId ? st.agents.find(a => a.id === selectedId) : undefined))
	const hue = useStore(st => (agent ? spaceHue(st.spaces, agent.space) : 170))
	const working = useStore(st => st.agents.filter(a => a.status === 'working' || a.status === 'starting').length)
	const perms = useStore(st => st.agents.some(a => a.pendingPermissions.length > 0))
	const unread = useFeedUnread(tab === 'feed')

	const active = Math.max(
		0,
		TABS.findIndex(t => t.id === tab),
	)
	const style = cssVars({ '--n': TABS.length, '--i': active })

	return (
		<nav className={s.bar} style={style} aria-label="Разделы">
			<span className={s.indicator} aria-hidden="true" />
			{TABS.map(t => {
				const isChat = t.id === 'chat'
				const disabled = isChat && !selectedId
				const badge = t.id === 'agents' ? working : t.id === 'feed' ? unread : 0
				return (
					<button
						key={t.id}
						type="button"
						className={`${s.tab} ${tab === t.id ? s.active : ''}`}
						aria-current={tab === t.id ? 'page' : undefined}
						disabled={disabled}
						onClick={() => setMobileTab(t.id)}
						title={disabled ? 'Выберите агента, чтобы открыть чат' : undefined}
					>
						<span className={s.icon}>
							{isChat && agent ? (
								<AgentAvatar name={agent.name} hue={hue} status={agent.status} size={24} />
							) : (
								<Icon name={t.icon} size={21} />
							)}
							{badge > 0 && (
								<span key={badge} className={`${s.badge} ${t.id === 'agents' ? s.badgeWorking : ''}`}>
									{badge > 99 ? '99+' : badge}
								</span>
							)}
							{t.id === 'agents' && perms && <span className={s.alert} title="Есть запросы разрешений" />}
						</span>
						<span className={s.label}>{isChat && agent ? agent.name : t.label}</span>
					</button>
				)
			})}
		</nav>
	)
}
