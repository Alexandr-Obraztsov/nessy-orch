/**
 * Чат с одним агентом (содержимое вкладки): компактная шапка со статусом и действиями,
 * плотная лента хода (сообщения, ответы, мысли, инструменты, разрешения), живой стриминг, ввод.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Composer } from '@/features/compose-message'
import { useAgentStream } from '@/entities/agent'
import { DaySeparator, JumpToLatest, MarkdownBody, TypingDots } from '@/entities/message'
import { useStickyScroll } from '@/shared/lib/useStickyScroll'
import { useStore } from '@/shared/model'
import { buildChatRows } from '../lib/buildChatRows'
import type { AgentChatProps } from '../model/types'
import { useToolDurations } from '../model/useToolDurations'
import s from './AgentChat.module.css'
import { ChatEventRow } from './ChatEventRow'
import { ChatHeader } from './ChatHeader'
import { ChatNotFound } from './ChatNotFound'
import { ChatSkeleton } from './ChatSkeleton'
import { PendingPermissions } from './PermissionRow'
import t from './Timeline.module.css'
import { ThinkingLive } from './ThoughtRow'

export function AgentChat({ agentId }: AgentChatProps) {
	// key — чтобы при смене агента сбросить всё локальное состояние (прокрутка, раскрытия)
	return <ChatView key={agentId} agentId={agentId} />
}

function ChatView({ agentId }: AgentChatProps) {
	const stream = useAgentStream(agentId)
	const stored = useStore(st => st.agents.find(a => a.id === agentId))
	const conn = useStore(st => st.conn)
	const agent = stored ?? (conn === 'live' ? null : stream.agent)

	const rows = useMemo(() => buildChatRows(stream.events, stream.live), [stream.events, stream.live])
	const durations = useToolDurations(stream.events, stream.ready)
	const shownPermissions = useMemo(
		() => new Set(stream.events.flatMap(e => (e.kind === 'permission' ? [e.requestId] : []))),
		[stream.events],
	)
	const working = agent?.status === 'working' || agent?.status === 'starting'
	const last = stream.events[stream.events.length - 1]
	const toolRunning = last?.kind === 'tool' && (last.status === 'in_progress' || last.status === 'pending')
	const typing = stream.ready && working && stream.live.length === 0 && !toolRunning
	const sticky = useStickyScroll(rows.length + (typing ? 1 : 0), stream.ready)

	// анимируем только события, пришедшие после проигрывания истории
	const seen = useRef(0)
	const seenAtRender = seen.current
	useEffect(() => {
		if (!stream.ready) return
		seen.current = Math.max(seen.current, stream.events[stream.events.length - 1]?.seq ?? 0, 1)
	}, [stream.events, stream.ready])
	const fresh = (seq: number): boolean => seenAtRender > 0 && seq > seenAtRender

	if (!agent) {
		return (
			<section className={s.chat} aria-label="Чат агента">
				{conn === 'live' ? <ChatNotFound id={agentId} /> : <ChatSkeleton />}
			</section>
		)
	}

	return (
		<section className={s.chat} aria-label="Чат агента">
			<ChatHeader agent={agent} />
			<div className={s.bodyWrap}>
				<div className={s.body} ref={sticky.scrollRef} onScroll={sticky.onScroll}>
					<div className={s.content} ref={sticky.contentRef}>
						{!stream.ready ? (
							<ChatSkeleton />
						) : rows.length === 0 && !typing ? (
							<div className={s.blank}>Пока ни одного сообщения — напишите агенту.</div>
						) : (
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
						)}
					</div>
				</div>
				<JumpToLatest visible={!sticky.atBottom} unseen={sticky.unseen} onClick={() => sticky.scrollToBottom()} />
			</div>
			{stream.ready && <PendingPermissions agent={agent} shown={shownPermissions} />}
			<Composer to={agent.id} onSent={() => sticky.scrollToBottom()} />
		</section>
	)
}
