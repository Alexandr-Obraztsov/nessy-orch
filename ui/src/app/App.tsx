/**
 * Корневой компонент: подключение к потоку оркестратора и адаптивная раскладка виджетов.
 */
import { useCallback, useEffect, useState } from 'react'
import { AddSpaceDialog } from '@/features/add-space'
import { SpawnAgentDialog } from '@/features/spawn-agent'
import { MEDIUM, NARROW, useMedia } from '@/shared/lib/useMedia'
import { connect, setMobileTab, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { AgentChat } from '@/widgets/agent-chat'
import { Feed } from '@/widgets/feed'
import { GraphView } from '@/widgets/graph'
import { Roster } from '@/widgets/roster'
import { TabBar } from '@/widgets/tabbar'
import { TopBar } from '@/widgets/topbar'
import s from './App.module.css'
import { useHotkeys } from './useHotkeys'

const cx = (...c: (string | false | undefined)[]): string => c.filter(Boolean).join(' ')

export function App() {
	const narrow = useMedia(NARROW)
	const medium = useMedia(MEDIUM)
	const selected = useView(v => v.selectedAgentId)
	const tab = useView(v => v.mobileTab)
	// средняя ширина: ростер — выдвижная панель поверх графа
	const [drawer, setDrawer] = useState(false)
	const toggleDrawer = useCallback(() => setDrawer(d => !d), [])

	useEffect(connect, [])
	useHotkeys()

	// вкладка «Чат» без выбранного агента бессмысленна — возвращаемся к списку
	useEffect(() => {
		if (tab === 'chat' && !selected) setMobileTab('agents')
	}, [tab, selected])

	useEffect(() => {
		if (!medium) setDrawer(false)
	}, [medium])

	// на узком экране показываем ровно один виджет; на широком — все колонки
	const show = (t: 'graph' | 'agents' | 'panel'): string | false => {
		if (!narrow) return false
		const visible = t === 'panel' ? tab === 'feed' || tab === 'chat' : tab === t
		return (visible && s.show) || false
	}
	const chat = selected && (!narrow || tab === 'chat')

	return (
		<div className={s.app}>
			<TopBar roster={medium ? { open: drawer, toggle: toggleDrawer } : null} />
			<main className={s.main}>
				<aside className={cx(s.roster, show('agents'), medium && drawer && s.drawerOpen)} aria-label="Агенты">
					<Roster />
				</aside>
				<section className={cx(s.graph, show('graph'))} aria-label="Граф агентов">
					<GraphView />
					{medium && drawer && <div className={s.scrim} onClick={() => setDrawer(false)} aria-hidden="true" />}
				</section>
				<section className={cx(s.panel, show('panel'))} aria-label={chat ? 'Чат агента' : 'Общая лента'}>
					{chat ? <AgentChat agentId={selected} /> : <Feed />}
				</section>
			</main>
			{narrow && <TabBar />}
			<SpawnAgentDialog />
			<AddSpaceDialog />
			<Toaster />
		</div>
	)
}
