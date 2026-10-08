import { memo, useState } from 'react'
import type { ToolEvent, ToolStatus } from '@contract'
import { clock } from '@/shared/lib/time'
import { Icon, type IconName } from '@/shared/ui'
import { prettyJson, toolIcon } from '../lib/toolIcon'
import s from './ToolCard.module.css'

const STATUS: Record<ToolStatus, { label: string; icon: IconName | null }> = {
	pending: { label: 'ожидает', icon: 'clock' },
	in_progress: { label: 'выполняется', icon: null },
	completed: { label: 'готово', icon: 'check' },
	failed: { label: 'ошибка', icon: 'x' },
}

/** Вызов инструмента: компактная карточка, раскрывается до ввода (JSON) и вывода. */
export const ToolCard = memo(function ToolCard({ ev, enter }: { ev: ToolEvent; enter: boolean }) {
	const [open, setOpen] = useState(false)
	const st = STATUS[ev.status]
	const hasInput = Object.keys(ev.input).length > 0
	return (
		<div className={[s.card, s[ev.status], open && s.open, enter && s.enter].filter(Boolean).join(' ')}>
			<button type="button" className={s.head} onClick={() => setOpen(v => !v)} aria-expanded={open}>
				<span className={s.icon}>
					<Icon name={toolIcon(ev.name)} size={15} />
				</span>
				<span className={s.titles}>
					<span className={s.title}>{ev.title || ev.name}</span>
					<span className={s.name}>
						{ev.name} · {clock(ev.ts)}
					</span>
				</span>
				<span className={s.chip}>
					{st.icon ? <Icon name={st.icon} size={12} strokeWidth={2.4} /> : <span className={s.spin} />}
					{st.label}
				</span>
				<Icon name="chevronDown" size={15} className={s.chev} />
			</button>
			{open && (
				<div className={s.details}>
					<div className={s.label}>Ввод</div>
					<pre className={s.pre}>{hasInput ? prettyJson(ev.input) : '—'}</pre>
					<div className={s.label}>Вывод</div>
					{ev.output ? (
						<pre className={[s.pre, s.output].join(' ')}>{ev.output}</pre>
					) : (
						<div className={s.none}>{ev.status === 'in_progress' || ev.status === 'pending' ? 'ещё нет…' : 'пусто'}</div>
					)}
				</div>
			)}
		</div>
	)
})
