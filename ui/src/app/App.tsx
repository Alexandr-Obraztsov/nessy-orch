/**
 * Корневой компонент: подключение к потоку оркестратора и адаптивная раскладка виджетов.
 */
import { useEffect } from 'react'
import { AddSpaceDialog } from '@/features/add-space'
import { SpawnAgentDialog } from '@/features/spawn-agent'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { connect, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { AgentChat } from '@/widgets/agent-chat'
import { Feed } from '@/widgets/feed'
import { GraphView } from '@/widgets/graph'
import { Roster } from '@/widgets/roster'
import { TabBar } from '@/widgets/tabbar'
import { TopBar } from '@/widgets/topbar'
import s from './App.module.css'
import { useHotkeys } from './useHotkeys'

export function App() {
	const narrow = useMedia(NARROW)
	const selected = useView(v => v.selectedAgentId)
	const tab = useView(v => v.mobileTab)

	useEffect(connect, [])
	useHotkeys()

	// на узком экране показываем ровно один виджет; на широком — все колонки
	const show = (t: 'graph' | 'agents' | 'panel'): string => {
		if (!narrow) return ''
		const visible = t === 'panel' ? tab === 'feed' || tab === 'chat' : tab === t
		return visible ? s.show ?? '' : ''
	}

	return (
		<div className={s.app}>
			<TopBar />
			<main className={s.main}>
				<aside className={`${s.roster} ${show('agents')}`} aria-label="Агенты">
					<Roster />
				</aside>
				<section className={`${s.graph} ${show('graph')}`} aria-label="Граф агентов">
					<GraphView />
				</section>
				<section className={`${s.panel} ${show('panel')}`} aria-label={selected ? 'Чат агента' : 'Общая лента'}>
					{selected && (!narrow || tab === 'chat') ? <AgentChat agentId={selected} /> : <Feed />}
				</section>
			</main>
			{narrow && <TabBar />}
			<SpawnAgentDialog />
			<AddSpaceDialog />
			<Toaster />
		</div>
	)
}
