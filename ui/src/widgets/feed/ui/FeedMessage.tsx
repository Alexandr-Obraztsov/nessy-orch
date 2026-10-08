import { memo } from 'react'
import type { Message } from '@contract'
import { AgentAvatar } from '@/entities/agent'
import { Bubble, MarkdownBody, NodeLink } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { YOU, openAgent, spaceHue, useStore } from '@/shared/model'
import { Icon } from '@/shared/ui'
import s from './FeedMessage.module.css'

interface Props {
	msg: Message
	first: boolean
	route: boolean
	waiting: boolean
	quote: string | null
	enter: boolean
}

/** Сообщение ленты: свои — справа акцентом, агентов — слева с аватаром и маршрутом. */
export const FeedMessage = memo(function FeedMessage({ msg, first, route, waiting, quote, enter }: Props) {
	const out = msg.from === YOU
	const sender = useStore(st => st.agents.find(a => a.id === msg.from))
	const hue = useStore(st => (sender ? spaceHue(st.spaces, sender.space) : 200))
	const failed = !!msg.failed

	const head = route ? (
		<>
			{!out && <NodeLink id={msg.from} strong />}
			<span className={s.route}>
				<Icon name="chevronRight" size={12} strokeWidth={2.4} className={s.arrow} />
				<NodeLink id={msg.to} />
			</span>
			{msg.kind === 'reply' && (
				<span className={s.reply} title="Ответ">
					<Icon name="reply" size={13} />
				</span>
			)}
		</>
	) : null

	const meta = (
		<>
			{waiting && (
				<span className={s.wait} title="Отправитель ждёт ответ синхронно">
					<Icon name="clock" size={11} />
					ждёт ответ
				</span>
			)}
			{failed && (
				<span className={s.failTag}>
					<Icon name="alert" size={11} />
					не доставлено
				</span>
			)}
			<time dateTime={new Date(msg.ts).toISOString()} title={new Date(msg.ts).toLocaleString('ru-RU')}>
				{clock(msg.ts)}
			</time>
		</>
	)

	return (
		<div className={[s.row, out ? s.out : s.in, first && s.first].filter(Boolean).join(' ')}>
			{!out &&
				(first ? (
					<button
						type="button"
						className={s.avatar}
						onClick={() => sender && openAgent(sender.id)}
						disabled={!sender}
						aria-label={sender ? `Открыть чат с ${sender.name}` : msg.from}
					>
						<AgentAvatar name={sender?.name ?? msg.from} hue={hue} status={sender?.status} size={32} />
					</button>
				) : (
					<span className={s.spacer} />
				))}
			<div className={s.col}>
				<Bubble side={out ? 'out' : 'in'} tone={failed ? 'failed' : 'default'} tail={first} head={head} meta={meta} enter={enter}>
					{quote !== null && (
						<div className={s.quote} title={quote}>
							{quote}
						</div>
					)}
					<MarkdownBody text={msg.text} collapseAt={300} onAccent={out && !failed} />
					{failed && msg.failed && !msg.text.includes(msg.failed) && <div className={s.failReason}>{msg.failed}</div>}
				</Bubble>
			</div>
		</div>
	)
})
