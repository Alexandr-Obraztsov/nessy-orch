/**
 * Мини-таймлайн хода: каждый вызов инструмента — отрезок, пропорциональный длительности,
 * цвет — статус; ожидание разрешения — жёлтая штриховка; у идущего хода — линия «сейчас».
 * Наведение — подсказка «заголовок · длительность», клик — раскрыть шаг в списке.
 */
import { useState } from 'react'
import { clock } from '@/shared/lib/time'
import { cssVars } from '@/shared/lib/style'
import { formatMs } from '../lib/toolIcon'
import type { Step, TimelineProps } from '../model/types'
import s from './Steps.module.css'

function tone(st: Step): string {
	if (st.kind === 'permission') return st.ev.resolved && !st.ev.approved ? 'deny' : 'wait'
	if (st.running) return 'run'
	if (st.ev.status === 'failed') return 'fail'
	return 'ok'
}

const title = (st: Step): string => (st.kind === 'tool' ? st.ev.title || st.ev.name : `Ждёт разрешения: ${st.ev.title}`)

export function StepsTimeline({ turn, onPick }: TimelineProps) {
	const [hover, setHover] = useState<string | null>(null)
	const span = Math.max(1000, turn.end - turn.start)
	const pos = (t: number): number => Math.min(100, Math.max(0, ((t - turn.start) / span) * 100))
	const hovered = turn.steps.find(x => x.key === hover) ?? null

	return (
		<div className={s.tl}>
			<div className={s.track} onMouseLeave={() => setHover(null)}>
				{turn.steps.map(st => {
					const left = pos(st.start)
					const width = Math.max(0.8, pos(st.start + (st.ms ?? 0)) - left)
					return (
						<button
							key={st.key}
							type="button"
							className={[s.seg, s[tone(st)], hover === st.key && s.segOn].filter(Boolean).join(' ')}
							style={cssVars({ '--l': `${left}%`, '--w': `${width}%` })}
							aria-label={`${title(st)}${st.ms !== null ? ` · ${formatMs(st.ms)}` : ''}`}
							onMouseEnter={() => setHover(st.key)}
							onFocus={() => setHover(st.key)}
							onBlur={() => setHover(null)}
							onClick={() => onPick(st.key)}
						/>
					)
				})}
				{turn.running && <span className={s.nowLine} aria-hidden="true" />}
				{hovered && (
					<div className={s.tip} style={cssVars({ '--x': `${pos(hovered.start + (hovered.ms ?? 0) / 2)}%` })} role="tooltip">
						<span className={s.tipTitle}>{title(hovered)}</span>
						<span className={s.tipTime}>{hovered.ms !== null ? formatMs(hovered.ms) : '—'}</span>
					</div>
				)}
			</div>
			<div className={s.axis}>
				<span>{clock(turn.start)}</span>
				<span>{turn.running ? <b className={s.nowLabel}>сейчас</b> : formatMs(turn.end - turn.start)}</span>
			</div>
		</div>
	)
}
