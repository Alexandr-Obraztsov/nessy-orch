/**
 * Сообщение агента в ленте — свёрнутая карточка в одну строку: аватар, имя, «ответ ✓», превью
 * без разметки, время. Клик / Enter раскрывает полный markdown, цитату исходного запроса и
 * кнопки «Свернуть» / «Открыть чат». Раскрытие запоминается (в памяти вкладки).
 */
import { memo } from 'react'
import { AgentAvatar } from '@/entities/agent'
import { MarkdownBody, NodeLink, plainText } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { YOU, nodeLabel, openAgent, useStore } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { replyOutcome } from '../lib/outcome'
import { useExpanded } from '../model/expanded'
import type { AgentCardProps, ReplyOutcome } from '../model/types'
import s from './Rows.module.css'

const OUTCOME: Record<ReplyOutcome, { label: string; title: string }> = {
	ok: { label: 'ответ', title: 'Ход завершён' },
	failed: { label: 'ответ', title: 'Ход завершился ошибкой' },
	interrupted: { label: 'ход прерван', title: 'Ход прерван' },
	message: { label: 'сообщение', title: 'Сообщение агента' },
}

export const AgentCard = memo(function AgentCard({ msg, quote, enter }: AgentCardProps) {
	const sender = useStore(st => st.agents.find(a => a.id === msg.from))
	const roleHue = useStore(st => (sender?.role ? (st.roles.find(r => r.id === sender.role)?.color ?? null) : null))
	const quoteFrom = useStore(st => (quote ? nodeLabel(st.agents, quote.from) : ''))
	const [expanded, toggle] = useExpanded(msg.id)
	const outcome = replyOutcome(msg)
	const o = OUTCOME[outcome]
	const toYou = msg.to === YOU

	return (
		<article
			className={[s.card, expanded && s.open, outcome === 'failed' && s.cardFailed, enter && s.enter].filter(Boolean).join(' ')}
			data-msg={msg.id}
			aria-label={`${o.label} от ${sender?.name ?? msg.from}`}
		>
			<div className={s.head} onClick={() => toggle()}>
				<span className={s.avatar}>
					<AgentAvatar name={sender?.name ?? msg.from} roleHue={roleHue} size={18} />
				</span>
				<span className={s.who}>
					<NodeLink id={msg.from} strong />
					{!toYou && (
						<>
							<Icon name="chevronRight" size={12} className={s.arrow} />
							<NodeLink id={msg.to} />
						</>
					)}
				</span>
				<span className={[s.kind, s[outcome]].join(' ')} title={o.title}>
					{o.label}
					{outcome === 'ok' && <Icon name="check" size={12} />}
					{outcome === 'failed' && <Icon name="x" size={12} />}
				</span>
				<button
					type="button"
					className={s.toggle}
					aria-expanded={expanded}
					aria-label={expanded ? 'Свернуть' : 'Развернуть'}
					onClick={e => {
						e.stopPropagation()
						toggle()
					}}
				>
					<span className={s.preview}>{expanded ? '' : plainText(msg.text)}</span>
					<time className={s.time} dateTime={new Date(msg.ts).toISOString()} title={new Date(msg.ts).toLocaleString('ru-RU')}>
						{clock(msg.ts)}
					</time>
					<Icon name="chevronDown" size={13} className={s.chev} />
				</button>
			</div>
			{expanded && (
				<div className={s.cardBody}>
					{quote && (
						<div className={s.quote} title={quote.text}>
							<Icon name="reply" size={12} className={s.quoteIcon} />
							<span className={s.quoteFrom}>{quoteFrom}:</span>
							<span className={s.quoteText}>{plainText(quote.text, 200)}</span>
						</div>
					)}
					<MarkdownBody text={msg.text} />
					{msg.failed && !msg.text.includes(msg.failed) && <div className={s.failReason}>{msg.failed}</div>}
					<div className={s.actions}>
						<button type="button" onClick={() => toggle(false)}>
							<Icon name="chevronDown" size={13} className={s.flip} />
							Свернуть
						</button>
						{sender && (
							<button type="button" onClick={() => openAgent(sender.id)}>
								<Icon name="chat" size={13} />
								Открыть чат
							</button>
						)}
					</div>
				</div>
			)}
		</article>
	)
})
