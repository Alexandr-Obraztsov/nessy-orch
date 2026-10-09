/**
 * Чипы-фильтры над таблицей: Все / Ждут разрешения / Работают / Ошибки / Выполнено со счётчиками.
 * Клик — фильтр, повторный клик — снять. Справа — подсказка по клавишам.
 */
import { useMemo } from 'react'
import { countStates, type StateCounts } from '@/entities/agent'
import { cssVars } from '@/shared/lib/style'
import { setFilter, useStore, useView, type StatusFilter } from '@/shared/model'
import { Kbd } from '@/shared/ui'
import s from './FilterBar.module.css'

const CHIPS: { key: StatusFilter & keyof StateCounts; label: string; color: string }[] = [
	{ key: 'all', label: 'Все', color: 'var(--gray-8)' },
	{ key: 'wait', label: 'Ждут разрешения', color: 'var(--status-wait)' },
	{ key: 'working', label: 'Работают', color: 'var(--status-working)' },
	{ key: 'error', label: 'Ошибки', color: 'var(--status-error)' },
	{ key: 'done', label: 'Выполнено', color: 'var(--status-done)' },
]

export function FilterBar() {
	const agents = useStore(st => st.agents)
	const filter = useView(v => v.filter)
	const counts = useMemo(() => countStates(agents), [agents])
	return (
		<nav className={s.bar} aria-label="Фильтры">
			{CHIPS.map(c => (
				<button
					key={c.key}
					type="button"
					className={[s.chip, counts[c.key] === 0 && c.key !== 'all' && s.zero].filter(Boolean).join(' ')}
					style={cssVars({ '--c': c.color })}
					aria-pressed={filter === c.key}
					onClick={() => setFilter(c.key)}
				>
					<i aria-hidden="true" />
					<span>{c.label}</span>
					<b key={counts[c.key]}>{counts[c.key]}</b>
				</button>
			))}
			<span className={s.hint} aria-hidden="true">
				<Kbd>j</Kbd>
				<Kbd>k</Kbd> навигация <Kbd>Enter</Kbd> детали <Kbd>Esc</Kbd> закрыть
			</span>
		</nav>
	)
}
