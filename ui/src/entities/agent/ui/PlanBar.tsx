/**
 * Сегментный бар плана: один сегмент на шаг. Сделанный шаг заливается слева направо (плавно),
 * текущий — наполовину и мерцает, впереди — пустой. Плана нет — неопределённая полоса,
 * пока агент работает. Шагов больше MAX_SEGMENTS — сплошная полоса с долей.
 */
import type { PlanEntry } from '@contract'
import { cssVars } from '@/shared/lib/style'
import type { AgentState } from '../lib/state.types'
import s from './PlanBar.module.css'

const MAX_SEGMENTS = 12

export interface PlanBarProps {
	entries: PlanEntry[] | null
	state: AgentState
	size?: 'sm' | 'md'
	className?: string
}

export function PlanBar({ entries, state, size = 'sm', className }: PlanBarProps) {
	const cls = [s.bar, s[size], className].filter(Boolean).join(' ')
	if (!entries || entries.length === 0) {
		const live = state === 'working' || state === 'starting' || state === 'wait'
		return <span className={[cls, s.indeterminate, !live && s.off].filter(Boolean).join(' ')} data-state={state} aria-hidden="true" />
	}
	const done = entries.filter(e => e.status === 'completed').length
	const label = `Выполнено ${done} из ${entries.length}`
	if (entries.length > MAX_SEGMENTS)
		return (
			<span
				className={[cls, s.solid].join(' ')}
				data-state={state}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={entries.length}
				aria-valuenow={done}
				aria-label={label}
				style={cssVars({ '--p': done / entries.length })}
			>
				<i />
			</span>
		)
	return (
		<span className={cls} data-state={state} role="progressbar" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={done} aria-label={label}>
			{entries.map((e, i) => (
				<span key={i} className={s.seg} data-s={e.status}>
					<i />
				</span>
			))}
		</span>
	)
}
