import { memo, useState } from 'react'
import { Icon } from '@/shared/ui'
import s from './ThoughtBlock.module.css'

/** «Размышления» агента — свёрнуты, видна первая строка. */
export const ThoughtBlock = memo(function ThoughtBlock({ text, enter }: { text: string; enter: boolean }) {
	const [open, setOpen] = useState(false)
	const firstLine = text.trim().split('\n')[0] ?? ''
	const multi = text.trim().length > firstLine.length || firstLine.length > 60
	return (
		<div className={[s.thought, open && s.open, enter && s.enter].filter(Boolean).join(' ')}>
			<button type="button" className={s.head} onClick={() => setOpen(v => !v)} aria-expanded={open} disabled={!multi}>
				<Icon name="brain" size={14} className={s.icon} />
				<span className={s.label}>Размышления</span>
				{!open && <span className={s.preview}>{firstLine}</span>}
				{multi && <Icon name="chevronDown" size={14} className={s.chev} />}
			</button>
			{open && <div className={s.body}>{text.trim()}</div>}
		</div>
	)
})

/** Живые мысли: «думает…» с мерцанием и последней строкой. */
export function ThinkingLive({ text }: { text: string }) {
	const lines = text.trim().split('\n')
	const last = lines[lines.length - 1] ?? ''
	return (
		<div className={[s.thought, s.live].join(' ')} role="status">
			<div className={s.head}>
				<Icon name="brain" size={14} className={s.icon} />
				<span className={[s.label, s.shimmer].join(' ')}>думает…</span>
				<span className={s.preview}>{last}</span>
			</div>
		</div>
	)
}
