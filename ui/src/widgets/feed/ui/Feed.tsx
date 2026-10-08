/**
 * «Общая лента» — групповой чат оператора и агентов: дни, группы сообщений, системные события,
 * липкая прокрутка с кнопкой «↓ N новых», composer с выбором адресата.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Composer } from '@/features/compose-message'
import { DaySeparator, JumpToLatest } from '@/entities/message'
import { useStickyScroll } from '@/shared/lib/useStickyScroll'
import { useStore, useView } from '@/shared/model'
import { buildRows } from '../lib/buildRows'
import { matchFilter } from '../lib/filter'
import s from './Feed.module.css'
import { FeedEmpty } from './FeedEmpty'
import { FeedEvent } from './FeedEvent'
import { FeedHeader } from './FeedHeader'
import { FeedMessage } from './FeedMessage'

export function Feed() {
	const messages = useStore(st => st.messages)
	const hasAgents = useStore(st => st.agents.some(a => a.status !== 'dead'))
	const filter = useView(v => v.feedFilter)

	const list = useMemo(() => messages.filter(m => matchFilter(m, filter)), [messages, filter])
	const rows = useMemo(() => buildRows(list, messages), [list, messages])
	const sticky = useStickyScroll(list.length, filter)

	// анимируем только сообщения, пришедшие после первого рендера
	const seen = useRef(0)
	const seenAtRender = seen.current
	useEffect(() => {
		const last = messages[messages.length - 1]
		if (last) seen.current = Math.max(seen.current, last.seq)
	}, [messages])
	const fresh = (seq: number): boolean => seenAtRender > 0 && seq > seenAtRender

	return (
		<div className={s.feed}>
			<FeedHeader count={list.length} />
			<div className={s.bodyWrap}>
				<div className={s.body} ref={sticky.scrollRef} onScroll={sticky.onScroll}>
					<div className={s.content} ref={sticky.contentRef}>
						{rows.length === 0 ? (
							<FeedEmpty filtered={filter !== 'all' && messages.length > 0} hasAgents={hasAgents} />
						) : (
							rows.map(r => {
								if (r.t === 'day') return <DaySeparator key={r.key} label={r.label} />
								if (r.t === 'event') return <FeedEvent key={r.key} msg={r.msg} enter={fresh(r.msg.seq)} />
								return (
									<FeedMessage
										key={r.key}
										msg={r.msg}
										first={r.first}
										route={r.route}
										waiting={r.waiting}
										quote={r.quote}
										enter={fresh(r.msg.seq)}
									/>
								)
							})
						)}
					</div>
				</div>
				<JumpToLatest visible={!sticky.atBottom} unseen={sticky.unseen} onClick={() => sticky.scrollToBottom()} />
			</div>
			<Composer onSent={() => sticky.scrollToBottom()} />
		</div>
	)
}
