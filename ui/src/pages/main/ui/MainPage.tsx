/**
 * Главный экран: чипы-фильтры, таблица агентов и панель деталей. Панель выезжает справа,
 * таблица плавно сужается и прячет колонки по своей ширине; на телефоне панель — нижний лист.
 * При закрытии содержимое панели остаётся на месте, пока она уезжает.
 */
import { useEffect, useState } from 'react'
import { closeAgent, useStore, useView } from '@/shared/model'
import { AgentDetail } from '@/widgets/agent-detail'
import { AgentTable } from '@/widgets/agent-table'
import { FilterBar } from '@/widgets/filter-bar'
import s from './MainPage.module.css'

const CLOSE_MS = 380

export function MainPage() {
	const selected = useView(v => v.selectedAgentId)
	const conn = useStore(st => st.conn)
	const exists = useStore(st => (selected ? st.agents.some(a => a.id === selected) : false))
	const [shown, setShown] = useState(selected)

	// агента удалили — закрываем детали (после снапшота, чтобы не закрыть до загрузки)
	useEffect(() => {
		if (selected && conn === 'live' && !exists) closeAgent()
	}, [selected, conn, exists])

	useEffect(() => {
		if (selected) {
			setShown(selected)
			return
		}
		const t = window.setTimeout(() => setShown(null), CLOSE_MS)
		return () => window.clearTimeout(t)
	}, [selected])

	const open = selected !== null
	return (
		<div className={s.page} data-panel={open ? 'open' : undefined}>
			<FilterBar />
			<div className={s.main}>
				<AgentTable />
				<aside className={s.panel} aria-label="Детали агента" aria-hidden={!open || undefined}>
					<div className={s.panelIn}>{shown && <AgentDetail agentId={shown} onClose={closeAgent} />}</div>
				</aside>
			</div>
			<div className={s.scrim} onClick={closeAgent} aria-hidden="true" />
		</div>
	)
}
