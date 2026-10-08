/**
 * Чат с одним агентом: шапка со статусом и действиями, история событий
 * (сообщения, ответы, мысли, инструменты, разрешения), живой стриминг и composer.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Composer } from '@/features/compose-message'
import { canMessage, useAgentStream } from '@/entities/agent'
import { Bubble, DaySeparator, JumpToLatest, MarkdownBody, TypingDots } from '@/entities/message'
import { useStickyScroll } from '@/shared/lib/useStickyScroll'
import { useStore } from '@/shared/model'
import { buildChatRows } from '../lib/buildChatRows'
import type { AgentChatProps } from '../model/types'
import s from './AgentChat.module.css'
import { ChatEventRow } from './ChatEventRow'
import { ChatHeader } from './ChatHeader'
import { ChatNotFound } from './ChatNotFound'
import { ChatSkeleton } from './ChatSkeleton'
import { PermissionBanner } from './PermissionBanner'
import { ThinkingLive } from './ThoughtBlock'

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
	const working = agent?.status === 'working' || agent?.status === 'starting'
	const streamingText = stream.live.some(r => r.kind === 'text')
	const thinking = stream.live.some(r => r.kind === 'thought')
	const typing = stream.ready && working && !streamingText && !thinking
	const sticky = useStickyScroll(rows.length + (typing ? 1 : 0), stream.ready)

	// анимируем только события, пришедшие после проигрывания истории
	const seen = useRef(0)
	const seenAtRender = seen.current
	useEffect(() => {
		if (!stream.ready) return
		const last = stream.events[stream.events.length - 1]
		seen.current = Math.max(seen.current, last?.seq ?? 0, 1)
	}, [stream.events, stream.ready])
	const fresh = (seq: number): boolean => seenAtRender > 0 && seq > seenAtRender

	if (!agent) {
		return <div className={s.chat}>{conn === 'live' ? <ChatNotFound id={agentId} /> : <ChatSkeleton />}</div>
	}

	return (
		<div className={s.chat}>
			<ChatHeader agent={agent} />
			<PermissionBanner agent={agent} />
			<div className={s.bodyWrap}>
				<div className={s.body} ref={sticky.scrollRef} onScroll={sticky.onScroll}>
					<div className={s.content} ref={sticky.contentRef}>
						{!stream.ready ? (
							<ChatSkeleton />
						) : rows.length === 0 && !typing ? (
							<div className={s.blank}>Пока ни одного сообщения — напишите агенту первым.</div>
						) : (
							rows.map(r => {
								if (r.t === 'day') return <DaySeparator key={r.key} label={r.label} />
								if (r.t === 'event')
									return <ChatEventRow key={r.key} ev={r.ev} agent={agent} first={r.first} enter={fresh(r.ev.seq)} />
								if (r.run.kind === 'thought')
									return (
										<div key={r.key} className={[s.row, s.left, s.wide, r.first && s.first].filter(Boolean).join(' ')}>
											<ThinkingLive text={r.run.text} />
										</div>
									)
								return (
									<div key={r.key} className={[s.row, s.left, s.wide, r.first && s.first].filter(Boolean).join(' ')}>
										<Bubble side="in" tail={r.first}>
											<MarkdownBody text={r.run.text} streaming />
										</Bubble>
									</div>
								)
							})
						)}
						{typing && (
							<div className={[s.row, s.left, s.first].join(' ')}>
								<Bubble side="in" tail enter>
									<TypingDots label={`${agent.name} работает`} />
								</Bubble>
							</div>
						)}
					</div>
				</div>
				<JumpToLatest visible={!sticky.atBottom} unseen={sticky.unseen} onClick={() => sticky.scrollToBottom()} />
			</div>
			<Composer
				to={agent.id}
				placeholder={`Сообщение для ${agent.name.length > 24 ? `${agent.name.slice(0, 22)}…` : agent.name}…`}
				disabledReason={canMessage(agent.status) ? null : 'Агент остановлен — сообщения не доставляются'}
				onSent={() => sticky.scrollToBottom()}
			/>
		</div>
	)
}
