/**
 * Рабочий экран (вариант A «Три колонки»):
 *   ≥ 1280 — Внимание | Поручения | Детали агента, журнал внизу;
 *   900–1279 — детали выезжают справа поверх списка;
 *   < 900 — нижние вкладки Внимание / Поручения / Журнал, детали на весь экран.
 */
import { useEffect } from 'react'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { closeAgent, useStore, useView } from '@/shared/model'
import { AgentDetail } from '@/widgets/agent-detail'
import { AttentionPanel } from '@/widgets/attention'
import { Journal } from '@/widgets/journal'
import { TasksPanel } from '@/widgets/tasks'
import type { MainPageProps } from '../model/types'
import { DetailEmpty } from './DetailEmpty'
import s from './MainPage.module.css'
import { MobileTabs } from './MobileTabs'

export function MainPage({ attention }: MainPageProps) {
	const narrow = useMedia(NARROW)
	const selected = useView(v => v.selectedAgentId)
	const tab = useView(v => v.mobileTab)
	const conn = useStore(st => st.conn)
	const exists = useStore(st => (selected ? st.agents.some(a => a.id === selected) : false))

	// агента удалили — закрываем детали (после снапшота, чтобы не закрыть до загрузки)
	useEffect(() => {
		if (selected && conn === 'live' && !exists) closeAgent()
	}, [selected, conn, exists])

	return (
		<div className={s.page} data-tab={tab} data-sel={selected ? '' : undefined}>
			<div className={s.cols}>
				<aside className={s.att} aria-label="Внимание">
					<AttentionPanel list={attention} />
				</aside>
				<div className={s.center}>
					<TasksPanel />
				</div>
				<aside className={s.detail} aria-label="Детали агента">
					{selected ? <AgentDetail key={selected} agentId={selected} onClose={closeAgent} /> : <DetailEmpty />}
				</aside>
			</div>
			{narrow ? tab === 'journal' && <Journal mode="full" /> : <Journal mode="drawer" />}
			{narrow && <MobileTabs attention={attention.total} />}
		</div>
	)
}
