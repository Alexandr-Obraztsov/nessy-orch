import type { BubbleProps } from '../model/types'
import s from './Bubble.module.css'

/** Пузырь сообщения в стиле мессенджера: входящий слева, свой — справа. */
export function Bubble({ side, tone = 'default', tail, head, meta, enter, children }: BubbleProps) {
	const cls = [s.bubble, s[side], tone === 'failed' && s.failed, tail && s.tail, enter && s.enter].filter(Boolean).join(' ')
	return (
		<div className={cls}>
			{head && <div className={s.head}>{head}</div>}
			<div className={s.body}>{children}</div>
			{meta && <div className={s.meta}>{meta}</div>}
		</div>
	)
}
