/**
 * Главный экран: одна задача или несколько рядом (2–3 колонки, у каждой свой заголовок и карточки),
 * поверх — окно агента. Агента, которого удалили, окно закрывает само.
 */
import { useEffect } from 'react'
import { closeAgent, useStore, useView } from '@/shared/model'
import { AgentWindow } from '@/widgets/agent-window'
import { TaskColumn } from '@/widgets/task-board'
import s from './MainPage.module.css'

export function MainPage() {
	const columns = useView(v => v.columns)
	const agentId = useView(v => v.agentId)
	const conn = useStore(st => st.conn)
	const exists = useStore(st => (agentId ? st.agents.some(a => a.id === agentId) : false))

	useEffect(() => {
		if (agentId && conn === 'live' && !exists) {
			// даём снапшоту дойти: агент мог появиться позже ссылки
			const t = window.setTimeout(closeAgent, 4000)
			return () => window.clearTimeout(t)
		}
		return undefined
	}, [agentId, conn, exists])

	const parallel = columns.length > 1
	return (
		<main className={s.page} data-cols={columns.length}>
			<div className={s.cols}>
				{columns.map(c => (
					<div key={c} className={s.colWrap}>
						<TaskColumn column={c} parallel={parallel} />
					</div>
				))}
			</div>
			<AgentWindow agentId={agentId} onClose={closeAgent} />
		</main>
	)
}
