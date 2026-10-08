import { memo } from 'react'
import { SystemLine } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import type { FeedEventProps } from '../model/types'

/** Системное событие ленты — одна мелкая приглушённая строка. */
export const FeedEvent = memo(function FeedEvent({ msg, enter }: FeedEventProps) {
	const error = msg.failed !== undefined || /ошибк|сбой|упал|failed|error/i.test(msg.text)
	return <SystemLine text={msg.text} level={error ? 'error' : 'info'} time={clock(msg.ts)} enter={enter} />
})
