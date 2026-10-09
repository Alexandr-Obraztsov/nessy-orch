/**
 * План-чеклист агента: ✓ сделанное (зачёркнуто и приглушено), текущий шаг — с искоркой и акцентом,
 * будущие — пустой кружок. Если шагов больше max — окно вокруг текущего и «+n» до/после;
 * в режиме lines окно ровно в max строк вместе со строками «+n», каждый шаг — в одну строку.
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
	/** max — это строки вместе с «+n», шаги в одну строку (карточка с фиксированной высотой плана) */
	lines?: boolean
	className?: string
}

function currentOf(entries: PlanEntry[]): number {
	let cur = entries.findIndex(e => e.status === 'in_progress')
	if (cur === -1) cur = entries.findIndex(e => e.status === 'pending')
	if (cur === -1) cur = entries.length - 1
	return cur
}

function windowOf(entries: PlanEntry[], max: number): [number, number] {
	if (entries.length <= max) return [0, entries.length]
	// текущий шаг — вторым в окне: виден предыдущий сделанный и дальнейшие
	const start = Math.max(0, Math.min(currentOf(entries) - 1, entries.length - max))
	return [start, start + max]
}

/** Окно ровно в lines строк: шаги плюс строки «+n» сверху и снизу, если они нужны. */
function windowOfLines(entries: PlanEntry[], lines: number): [number, number] {
	const n = entries.length
	if (n <= lines) return [0, n]
	const cur = currentOf(entries)
	let k = Math.max(1, lines - 2)
	let start = Math.max(0, Math.min(cur - 1, n - k))
	if (start === 0) k = lines - 1
	else if (start + k >= n) {
		k = lines - 1
		start = n - k
	}
	return [start, start + k]
}

export function PlanList({ entries, live, max, lines, className }: PlanListProps) {
	const [from, to] = max ? (lines ? windowOfLines(entries, max) : windowOf(entries, max)) : [0, entries.length]
	const before = from
	const after = entries.length - to
	return (
		<ol className={[s.plan, className].filter(Boolean).join(' ')} data-lines={lines || undefined} aria-label="План">
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
