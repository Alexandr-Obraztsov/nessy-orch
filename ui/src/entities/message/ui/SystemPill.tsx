import { Icon } from '@/shared/ui'
import type { SystemPillProps } from '../model/types'
import s from './SystemPill.module.css'

/** Системное событие — маленькая плашка по центру. */
export function SystemPill({ level = 'info', time, enter, children }: SystemPillProps) {
	return (
		<div className={[s.row, enter && s.enter].filter(Boolean).join(' ')}>
			<div className={[s.pill, level === 'error' && s.error].filter(Boolean).join(' ')}>
				{level === 'error' && <Icon name="alert" size={13} />}
				<span className={s.text}>{children}</span>
				{time && <time className={s.time}>{time}</time>}
			</div>
		</div>
	)
}
