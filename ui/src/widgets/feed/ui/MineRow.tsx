import { memo, useLayoutEffect, useRef, useState } from 'react'
import { NodeLink } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { useStore } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { useExpanded } from '../model/expanded'
import type { MineRowProps } from '../model/types'
import s from './Rows.module.css'

/** Ваше сообщение: строка журнала «Вы → агент · время», текст до 3 строк (раскрывается). */
export const MineRow = memo(function MineRow({ msg, answered, enter }: MineRowProps) {
	const working = useStore(st => {
		const a = st.agents.find(x => x.id === msg.to)
		return !!a && (a.status === 'working' || a.status === 'starting')
	})
	const [expanded, toggle] = useExpanded(`mine:${msg.id}`)
	const text = useRef<HTMLDivElement>(null)
	const [overflow, setOverflow] = useState(false)

	useLayoutEffect(() => {
		const el = text.current
		if (!el || expanded) return
		const measure = (): void => setOverflow(el.scrollHeight > el.clientHeight + 1)
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		return () => ro.disconnect()
	}, [expanded, msg.text])

	const pending = !answered && !msg.failed && working
	return (
		<div className={[s.mine, msg.failed && s.mineFailed, enter && s.enter].filter(Boolean).join(' ')} data-msg={msg.id}>
			<div className={s.line}>
				<span className={s.you}>Вы</span>
				<Icon name="chevronRight" size={12} className={s.arrow} />
				<NodeLink id={msg.to} strong />
				{pending && (
					<span className={s.pending} role="status">
						<span className={s.spin} />в работе…
					</span>
				)}
				{msg.failed && (
					<span className={s.failTag} title={msg.failed}>
						<Icon name="alert" size={12} />
						не доставлено
					</span>
				)}
				<time className={s.time} dateTime={new Date(msg.ts).toISOString()} title={new Date(msg.ts).toLocaleString('ru-RU')}>
					{clock(msg.ts)}
				</time>
			</div>
			<div ref={text} className={[s.mineText, !expanded && s.clamp].filter(Boolean).join(' ')}>
				{msg.text}
			</div>
			{(overflow || expanded) && (
				<button type="button" className={s.more} onClick={() => toggle()} aria-expanded={expanded}>
					{expanded ? 'Свернуть' : 'Показать полностью'}
				</button>
			)}
			{msg.failed && !msg.text.includes(msg.failed) && <div className={s.failReason}>{msg.failed}</div>}
		</div>
	)
})
