import { memo } from 'react'
import type { Message } from '@contract'
import { SystemPill } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { openAgent, useStore } from '@/shared/model'
import { splitName } from '../lib/splitName'

/** Системное событие ленты; имя агента, о котором событие, — ссылка на его чат. */
export const FeedEvent = memo(function FeedEvent({ msg, enter }: { msg: Message; enter: boolean }) {
	const agent = useStore(st => st.agents.find(a => a.id === msg.to))
	const parts = splitName(msg.text, agent?.name)
	const error = msg.failed !== undefined || /ошибк|сбой|упал|failed|error/i.test(msg.text)
	return (
		<SystemPill level={error ? 'error' : 'info'} time={clock(msg.ts)} enter={enter}>
			{parts && agent ? (
				<>
					{parts[0]}
					<button type="button" onClick={() => openAgent(agent.id)}>
						{parts[1]}
					</button>
					{parts[2]}
				</>
			) : (
				msg.text
			)}
		</SystemPill>
	)
})
