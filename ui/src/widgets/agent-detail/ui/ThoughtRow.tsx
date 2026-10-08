import { memo, useState } from 'react'
import { firstLine } from '@/entities/message'
import { Icon } from '@/shared/ui'
import type { ThoughtRowProps } from '../model/types'
import t from './Timeline.module.css'

/** «Размышления · первая строка» — одна приглушённая строка, раскрывается целиком. */
export const ThoughtRow = memo(function ThoughtRow({ text, enter }: ThoughtRowProps) {
	const [open, setOpen] = useState(false)
	const body = text.trim()
	return (
		<div className={[t.thought, open && t.open, enter && t.enter].filter(Boolean).join(' ')}>
			<button type="button" className={t.rowBtn} onClick={() => setOpen(v => !v)} aria-expanded={open}>
				<Icon name="brain" size={13} className={t.rowIcon} />
				<span className={t.thoughtLabel}>Размышления</span>
				{!open && <span className={t.thoughtPreview}>· {firstLine(body)}</span>}
				<Icon name="chevronDown" size={13} className={t.chev} />
			</button>
			{open && <div className={t.thoughtBody}>{body}</div>}
		</div>
	)
})

/** Живые мысли: «думает…» и последняя строка. */
export function ThinkingLive({ text }: { text: string }) {
	const lines = text.trim().split('\n')
	return (
		<div className={[t.thought, t.live].join(' ')} role="status">
			<div className={t.rowBtn}>
				<Icon name="brain" size={13} className={t.rowIcon} />
				<span className={t.thoughtLabel}>думает…</span>
				<span className={t.thoughtPreview}>{lines[lines.length - 1] ?? ''}</span>
			</div>
		</div>
	)
}
