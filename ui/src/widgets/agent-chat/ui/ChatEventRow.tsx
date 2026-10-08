import { memo } from 'react'
import type { AgentEvent, AgentView } from '@contract'
import { Bubble, MarkdownBody, NodeLink, SystemPill } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { YOU } from '@/shared/model'
import s from './AgentChat.module.css'
import { PermissionCard } from './PermissionCard'
import { ThoughtBlock } from './ThoughtBlock'
import { ToolCard } from './ToolCard'

interface Props {
	ev: AgentEvent
	agent: AgentView
	first: boolean
	enter: boolean
}

/** Одно событие чата агента. */
export const ChatEventRow = memo(function ChatEventRow({ ev, agent, first, enter }: Props) {
	const time = <time>{clock(ev.ts)}</time>
	switch (ev.kind) {
		case 'user': {
			const out = ev.from === YOU
			return (
				<div className={[s.row, out ? s.right : s.left, first && s.first].filter(Boolean).join(' ')}>
					<Bubble
						side={out ? 'out' : 'in'}
						tail={first}
						enter={enter}
						meta={time}
						head={
							out ? undefined : (
								<>
									<NodeLink id={ev.from} strong />
									<span className={s.to}>→ {agent.name}</span>
								</>
							)
						}
					>
						<MarkdownBody text={ev.text} collapseAt={300} onAccent={out} />
					</Bubble>
				</div>
			)
		}
		case 'text':
			return (
				<div className={[s.row, s.left, s.wide, first && s.first].filter(Boolean).join(' ')}>
					<Bubble side="in" tail={first} enter={enter} meta={time}>
						<MarkdownBody text={ev.text} collapseAt={420} />
					</Bubble>
				</div>
			)
		case 'thought':
			return (
				<div className={[s.row, s.left, s.wide, first && s.first].filter(Boolean).join(' ')}>
					<ThoughtBlock text={ev.text} enter={enter} />
				</div>
			)
		case 'tool':
			return (
				<div className={[s.row, s.left, s.wide, first && s.first].filter(Boolean).join(' ')}>
					<ToolCard ev={ev} enter={enter} />
				</div>
			)
		case 'permission':
			return (
				<div className={[s.row, s.left, s.wide, first && s.first].filter(Boolean).join(' ')}>
					<PermissionCard ev={ev} agent={agent} enter={enter} />
				</div>
			)
		case 'system':
			return (
				<SystemPill level={ev.level} time={clock(ev.ts)} enter={enter}>
					{ev.text}
				</SystemPill>
			)
	}
})
