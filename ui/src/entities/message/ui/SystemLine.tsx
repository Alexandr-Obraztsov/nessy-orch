import type { SystemLineProps } from '../model/types'
import s from './SystemLine.module.css'

/** Системное событие — одна мелкая приглушённая строка по центру. */
export function SystemLine({ text, level = 'info', time, enter }: SystemLineProps) {
	return (
		<div className={[s.line, level === 'error' && s.error, enter && s.enter].filter(Boolean).join(' ')} title={text}>
			<span className={s.text}>{text}</span>
			{time && <time className={s.time}>{time}</time>}
		</div>
	)
}
