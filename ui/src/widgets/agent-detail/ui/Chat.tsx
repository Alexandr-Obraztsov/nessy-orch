import { useState } from 'react'
import { MarkdownBody } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { YOU, nodeLabel, useStore } from '@/shared/model'
import type { ChatProps } from '../model/types'
import s from './AgentDetail.module.css'

/** Переписка с агентом — свёрнута, только чтение: поручения, ответы агента, системные строки. */
export function Chat({ agent, events, ready }: ChatProps) {
	const [open, setOpen] = useState(false)
	const agents = useStore(st => st.agents)
	const rows = events.filter(e => e.kind === 'user' || e.kind === 'text' || (e.kind === 'system' && e.level === 'error'))
	return (
		<details className={s.chat} open={open} onToggle={e => setOpen(e.currentTarget.open)}>
			<summary>
				Переписка <em>{ready ? rows.length : ''}</em>
			</summary>
			{open && (
				<div className={s.msgs} role="log" aria-label={`Переписка с ${agent.name}`}>
					{!ready && <div className={s.muted}>Загрузка…</div>}
					{ready && rows.length === 0 && <div className={s.muted}>Сообщений пока нет</div>}
					{rows.map(e => {
						if (e.kind === 'user')
							return (
								<div key={e.seq} className={`${s.msg} ${s.msgIn}`}>
									<small>
										{e.from === YOU ? 'Оркестратор' : nodeLabel(agents, e.from)} · {clock(e.ts)}
									</small>
									<MarkdownBody text={e.text} />
								</div>
							)
						if (e.kind === 'text')
							return (
								<div key={e.seq} className={s.msg}>
									<small>
										{agent.name} · {clock(e.ts)}
									</small>
									<MarkdownBody text={e.text} />
								</div>
							)
						return (
							<div key={e.seq} className={s.sys}>
								{e.kind === 'system' ? e.text : ''}
							</div>
						)
					})}
				</div>
			)}
		</details>
	)
}
