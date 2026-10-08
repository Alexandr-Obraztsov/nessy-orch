/**
 * Корневой компонент: подключение к потоку и каркас как в Obsidian —
 * рейка | левая панель | вкладки + содержимое, строка состояния внизу.
 * Узкие экраны (< 900px): верхняя панель, левая панель выезжает поверх.
 */
import { useEffect } from 'react'
import { RoleDot } from '@/entities/role'
import { AddSpaceDialog } from '@/features/add-space'
import { AgentConfirmHost } from '@/features/agent-actions'
import { SpawnAgentDialog } from '@/features/spawn-agent'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { activeTab, closeTab, connect, toggleSidebar, useStore, useView } from '@/shared/model'
import { Icon, StatusDot, Toaster } from '@/shared/ui'
import { MobileBar } from '@/widgets/mobile-bar'
import { Ribbon } from '@/widgets/ribbon'
import { Sidebar } from '@/widgets/sidebar'
import { StatusBar } from '@/widgets/statusbar'
import { TabStrip, useTabMeta } from '@/widgets/tabs'
import s from './App.module.css'
import { MainPane } from './MainPane'
import { useHotkeys } from './useHotkeys'

export function App() {
	const narrow = useMedia(NARROW)
	const drawer = useView(v => v.sidebarOpen)
	const tab = useView(v => activeTab(v))
	const index = useView(v => v.active)
	const meta = useTabMeta(tab)
	const conn = useStore(st => st.conn)

	useEffect(connect, [])
	useHotkeys()

	// панель-шторка только на узких экранах
	useEffect(() => {
		if (!narrow && drawer) toggleSidebar(false)
	}, [narrow, drawer])

	useEffect(() => {
		document.title = tab.kind === 'feed' ? 'nessy-orch' : `${meta.title} — nessy-orch`
	}, [tab.kind, meta.title])

	const lead = meta.status ? (
		<StatusDot color={meta.status.color} pulse={meta.status.pulse} size={8} />
	) : meta.roleHue !== null ? (
		<RoleDot hue={meta.roleHue} />
	) : (
		<Icon name={meta.icon} size={16} />
	)

	return (
		<div className={`${s.app} ${narrow ? s.narrow : ''}`} data-conn={conn}>
			{narrow ? (
				<MobileBar title={meta.title} lead={lead} onCloseTab={meta.closable ? () => closeTab(index) : undefined} />
			) : (
				<Ribbon />
			)}
			<aside className={`${s.side} ${drawer ? s.sideOpen : ''}`} aria-label="Левая панель">
				<Sidebar />
			</aside>
			{narrow && drawer && <div className={s.scrim} onClick={() => toggleSidebar(false)} aria-hidden="true" />}
			<main className={s.main}>
				{!narrow && <TabStrip />}
				<MainPane />
			</main>
			<StatusBar />
			<SpawnAgentDialog />
			<AddSpaceDialog />
			<AgentConfirmHost />
			<Toaster />
		</div>
	)
}
