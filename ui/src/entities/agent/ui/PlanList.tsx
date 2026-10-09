/**
 * План-чеклист агента: ✓ сделанное (зачёркнуто и приглушено), текущий шаг — с искоркой и акцентом,
 * будущие — пустой кружок. Если шагов больше max — окно вокруг текущего и «+n» до/после.
 */
import type { PlanEntry } from '@contract'
import { plural } from '@/shared/lib/plural'
import { Sparkle } from '@/shared/ui'
import s from './PlanList.module.css'

export interface PlanListProps {
	entries: PlanEntry[]
	/** агент работает — у текущего шага живая искорка */
	live: boolean
	/** сколько шагов показывать (окно вокруг текущего); без ограничения — все */
	max?: number
	className?: string
}

function windowOf(entries: PlanEntry[], max: number): [number, number] {
	if (entries.length <= max) return [0, entries.length]
	let cur = entries.findIndex(e => e.status === 'in_progress')
	if (cur === -1) cur = entries.findIndex(e => e.status === 'pending')
	if (cur === -1) cur = entries.length - 1
	// текущий шаг — вторым в окне: виден предыдущий сделанный и дальнейшие
	const start = Math.max(0, Math.min(cur - 1, entries.length - max))
	return [start, start + max]
}

export function PlanList({ entries, live, max, className }: PlanListProps) {
	const [from, to] = max ? windowOf(entries, max) : [0, entries.length]
	const before = from
	const after = entries.length - to
	return (
		<ol className={[s.plan, className].filter(Boolean).join(' ')} aria-label="План">
			{before > 0 && <li className={s.more}>{`+${before} выполнено`}</li>}
			{entries.slice(from, to).map((e, i) => (
				<li key={from + i} className={s.step} data-s={e.status}>
					<span className={s.mark} aria-hidden="true">
						{e.status === 'completed' ? (
							<svg viewBox="0 0 16 16" fill="none" strokeLinecap="round" strokeLinejoin="round">
								<path d="M3.8 8.4l2.7 2.7 5.7-6" />
							</svg>
						) : e.status === 'in_progress' ? (
							live ? (
								<Sparkle />
							) : (
								<i className={s.cur} />
							)
						) : (
							<i className={s.todo} />
						)}
					</span>
					<span className={s.text}>
						<span className="sr-only">{e.status === 'completed' ? 'сделано: ' : e.status === 'in_progress' ? 'сейчас: ' : 'впереди: '}</span>
						{e.content}
					</span>
				</li>
			))}
			{after > 0 && <li className={s.more}>{`+${plural(after, 'шаг', 'шага', 'шагов')} впереди`}</li>}
		</ol>
	)
}
