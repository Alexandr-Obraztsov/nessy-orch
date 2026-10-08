/**
 * Счётчики сводки — они же фильтры списка поручений. Повторный клик снимает фильтр.
 */
import { StatusIcon, type AgentState } from '@/entities/agent'
import { countTasks, useTasks } from '@/entities/task'
import { setFilter, useView, type StatusFilter } from '@/shared/model'
import s from './TopBar.module.css'

const DEFS: Array<{ filter: Exclude<StatusFilter, 'all'>; icon: AgentState; label: string }> = [
	{ filter: 'attention', icon: 'wait', label: 'ждут вас' },
	{ filter: 'error', icon: 'error', label: 'ошибка' },
	{ filter: 'working', icon: 'working', label: 'в работе' },
	{ filter: 'done', icon: 'done', label: 'готово' },
]

export function SummaryChips({ className }: { className?: string }) {
	const tasks = useTasks()
	const counts = countTasks(tasks)
	const filter = useView(v => v.filter)
	return (
		<div className={[s.chips, className].filter(Boolean).join(' ')} role="group" aria-label="Сводка и фильтры">
			{DEFS.map(d => (
				<button
					key={d.filter}
					type="button"
					className={[s.chip, counts[d.filter] === 0 && s.zero].filter(Boolean).join(' ')}
					aria-pressed={filter === d.filter}
					title={`Фильтр: ${d.label}`}
					data-filter={d.filter}
					onClick={() => setFilter(d.filter)}
				>
					<StatusIcon state={d.icon} size={13} />
					<b>{counts[d.filter]}</b> {d.label}
				</button>
			))}
		</div>
	)
}
