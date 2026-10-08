/**
 * «Лента» — общий журнал разговора с агентами. По умолчанию в ней только ваши сообщения и
 * итоговые ответы агентов (свёрнутыми карточками, чтобы не засорять ленту); переписка агентов
 * между собой и системные события включаются переключателями в шапке.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Composer } from '@/features/compose-message'
import { DaySeparator, JumpToLatest } from '@/entities/message'
import { useStickyScroll } from '@/shared/lib/useStickyScroll'
import { useStore, useView } from '@/shared/model'
import { buildRows } from '../lib/buildRows'
import { visibleInFeed } from '../lib/filter'
import { AgentCard } from './AgentCard'
import s from './Feed.module.css'
import { FeedEmpty } from './FeedEmpty'
import { FeedEvent } from './FeedEvent'
import { FeedHeader } from './FeedHeader'
import { MineRow } from './MineRow'

export function Feed() {
	const messages = useStore(st => st.messages)
	const opts = useView(v => v.feed)

	const list = useMemo(() => messages.filter(m => visibleInFeed(m, opts)), [messages, opts])
	const rows = useMemo(() => buildRows(list, messages), [list, messages])
	const sticky = useStickyScroll(list.length, `${opts.agentChatter}:${opts.system}`)

	// анимируем только сообщения, пришедшие после первого рендера
	const seen = useRef(-1)
	const seenAtRender = seen.current
	useEffect(() => {
		seen.current = Math.max(seen.current, messages[messages.length - 1]?.seq ?? 0)
	}, [messages])
	const fresh = (seq: number): boolean => seenAtRender >= 0 && seq > seenAtRender

	return (
		<section className={s.feed} aria-label="Лента">
			<FeedHeader count={list.length} />
			<div className={s.bodyWrap}>
				<div className={s.body} ref={sticky.scrollRef} onScroll={sticky.onScroll}>
					<div className={s.content} ref={sticky.contentRef}>
						{rows.length === 0 ? (
							<FeedEmpty hidden={messages.length > 0} />
						) : (
							<div className={s.column} role="log" aria-label="Сообщения ленты">
								{rows.map(r => {
									switch (r.t) {
										case 'day':
											return <DaySeparator key={r.key} label={r.label} />
										case 'event':
											return <FeedEvent key={r.key} msg={r.msg} enter={fresh(r.msg.seq)} />
										case 'mine':
											return <MineRow key={r.key} msg={r.msg} answered={r.answered} enter={fresh(r.msg.seq)} />
										case 'agent':
											return <AgentCard key={r.key} msg={r.msg} quote={r.quote} enter={fresh(r.msg.seq)} />
									}
								})}
							</div>
						)}
					</div>
				</div>
				<JumpToLatest visible={!sticky.atBottom} unseen={sticky.unseen} onClick={() => sticky.scrollToBottom()} />
			</div>
			<Composer onSent={() => sticky.scrollToBottom()} />
		</section>
	)
}
