import { memo } from 'react'
import { MarkdownBody, NodeLink, SystemLine } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { YOU } from '@/shared/model'
import type { ChatEventRowProps } from '../model/types'
import { PermissionRow } from './PermissionRow'
import { ThoughtRow } from './ThoughtRow'
import t from './Timeline.module.css'
import { ToolRow } from './ToolRow'

/** Одно событие чата агента. */
export const ChatEventRow = memo(function ChatEventRow({ ev, agent, enter, toolMs }: ChatEventRowProps) {
	const anim = enter ? t.enter : undefined
	switch (ev.kind) {
		case 'user': {
			if (ev.from === YOU)
				return (
					<div className={[t.outRow, anim].filter(Boolean).join(' ')} data-event={ev.seq}>
						<div className={t.out}>
							<div className={t.outText}>{ev.text}</div>
							<time className={t.outTime}>{clock(ev.ts)}</time>
						</div>
					</div>
				)
			return (
				<div className={[t.incoming, anim].filter(Boolean).join(' ')} data-event={ev.seq}>
					<div className={t.inHead}>
						<NodeLink id={ev.from} strong />
						<span className={t.muted}>→ {agent.name}</span>
						<time className={t.time}>{clock(ev.ts)}</time>
					</div>
					<MarkdownBody text={ev.text} />
				</div>
			)
		}
		case 'text':
			return (
				<div className={[t.answer, anim].filter(Boolean).join(' ')} title={clock(ev.ts)} data-event={ev.seq}>
					<MarkdownBody text={ev.text} />
				</div>
			)
		case 'thought':
			return <ThoughtRow text={ev.text} enter={enter} />
		case 'tool':
			return <ToolRow ev={ev} enter={enter} durationMs={toolMs} />
		case 'permission':
			return <PermissionRow ev={ev} agent={agent} enter={enter} />
		case 'system':
			return <SystemLine text={ev.text} level={ev.level} time={clock(ev.ts)} enter={enter} />
	}
})
