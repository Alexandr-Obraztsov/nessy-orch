/** «Чат»: полная переписка с агентом — сообщения, ответы, свёрнутые мысли, инструменты, системные строки. */
import { useEffect, useMemo, useRef } from 'react'
import { DaySeparator, MarkdownBody, TypingDots } from '@/entities/message'
import { buildChatRows } from '../lib/buildChatRows'
import type { ChatTabProps } from '../model/types'
import s from './AgentDetail.module.css'
import { ChatEventRow } from './ChatEventRow'
import { ThinkingLive } from './ThoughtRow'
import t from './Timeline.module.css'

export function ChatTab({ agent, events, live, ready, durations }: ChatTabProps) {
	const rows = useMemo(() => buildChatRows(events, live), [events, live])
	const working = agent.status === 'working' || agent.status === 'starting'
	const last = events[events.length - 1]
	const toolRunning = last?.kind === 'tool' && (last.status === 'in_progress' || last.status === 'pending')
	const typing = ready && working && live.length === 0 && !toolRunning

	// анимируем только события, пришедшие после проигрывания истории
	const seen = useRef(0)
	const seenAtRender = seen.current
	useEffect(() => {
		if (!ready) return
		seen.current = Math.max(seen.current, events[events.length - 1]?.seq ?? 0, 1)
	}, [events, ready])
	const fresh = (seq: number): boolean => seenAtRender > 0 && seq > seenAtRender

	if (!ready)
		return (
			<div className={s.skeleton} aria-busy="true" aria-label="Загрузка истории">
				<i style={{ width: '40%', alignSelf: 'flex-end' }} />
				<i style={{ width: '78%', height: 44 }} />
				<i style={{ width: '52%', height: 14 }} />
				<i style={{ width: '84%', height: 60 }} />
			</div>
		)
	if (rows.length === 0 && !typing) return <div className={s.empty}>Пока ни одного сообщения — напишите агенту.</div>

	return (
		<div className={t.timeline} role="log" aria-label={`Переписка с ${agent.name}`}>
			{rows.map(r => {
				if (r.t === 'day') return <DaySeparator key={r.key} label={r.label} />
				if (r.t === 'event')
					return (
						<ChatEventRow
							key={r.key}
							ev={r.ev}
							agent={agent}
							enter={fresh(r.ev.seq)}
							toolMs={r.ev.kind === 'tool' ? durations.get(r.ev.toolId) : undefined}
						/>
					)
				if (r.run.kind === 'thought') return <ThinkingLive key={r.key} text={r.run.text} />
				return (
					<div key={r.key} className={t.answer}>
						<MarkdownBody text={r.run.text} streaming />
					</div>
				)
			})}
			{typing && (
				<div className={t.typing}>
					<TypingDots label={`${agent.name} работает`} />
				</div>
			)}
		</div>
	)
}
