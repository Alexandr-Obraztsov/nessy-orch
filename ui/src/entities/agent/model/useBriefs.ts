import { useMemo } from 'react'
import { useStore } from '@/shared/model'
import { firstMessages } from '../lib/brief'

/** Первые сообщения агентам (реактивно, пересчёт только при новых сообщениях ленты). */
export function useFirstMessages(): ReturnType<typeof firstMessages> {
	const messages = useStore(s => s.messages)
	return useMemo(() => firstMessages(messages), [messages])
}
