import { memo, useState } from 'react'
import { Icon } from '@/shared/ui'
import { formatMs, prettyJson, toolIcon } from '../lib/toolIcon'
import type { ToolRowProps } from '../model/types'
import t from './Timeline.module.css'

const LABEL = { pending: 'ожидает', in_progress: 'выполняется', completed: 'готово', failed: 'ошибка' } as const

/** Вызов инструмента — строка 26px: иконка, заголовок, статус, длительность; раскрывается до ввода и вывода. */
export const ToolRow = memo(function ToolRow({ ev, enter, durationMs }: ToolRowProps) {
	const [open, setOpen] = useState(false)
	const running = ev.status === 'pending' || ev.status === 'in_progress'
	const hasInput = Object.keys(ev.input).length > 0
	return (
		<div className={[t.tool, t[ev.status], open && t.open, enter && t.enter].filter(Boolean).join(' ')} data-tool={ev.toolId}>
			<button type="button" className={t.rowBtn} onClick={() => setOpen(v => !v)} aria-expanded={open} title={`${ev.name} · ${LABEL[ev.status]}`}>
				<Icon name={toolIcon(ev.name)} size={13} className={t.rowIcon} />
				<span className={t.toolTitle}>{ev.title || ev.name}</span>
				<span className={t.toolStatus} aria-label={LABEL[ev.status]}>
					{running ? <span className={t.spin} /> : <Icon name={ev.status === 'failed' ? 'x' : 'check'} size={12} />}
				</span>
				{durationMs !== undefined && !running && <span className={t.toolTime}>{formatMs(durationMs)}</span>}
				<Icon name="chevronDown" size={13} className={t.chev} />
			</button>
			{open && (
				<div className={t.toolDetails}>
					<div className={t.label}>Ввод · {ev.name}</div>
					<pre className={t.pre}>{hasInput ? prettyJson(ev.input) : '—'}</pre>
					<div className={t.label}>Вывод</div>
					{ev.output ? (
						<pre className={[t.pre, ev.status === 'failed' && t.preFailed].filter(Boolean).join(' ')}>{ev.output}</pre>
					) : (
						<div className={t.none}>{running ? 'ещё нет…' : 'пусто'}</div>
					)}
				</div>
			)}
		</div>
	)
})
