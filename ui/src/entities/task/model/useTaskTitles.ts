import { useMemo } from 'react'
import { useStore } from '@/shared/model'
import { firstMessages, taskTitles } from '../lib/build'

/** Задачи всех агентов (реактивно): id агента → заголовок. */
export function useTaskTitles(): Map<string, string> {
	const agents = useStore(s => s.agents)
	const messages = useStore(s => s.messages)
	// первые сообщения пересчитываем только при новых сообщениях, а не на каждом событии агента
	const first = useMemo(() => firstMessages(messages), [messages])
	return useMemo(() => taskTitles(agents, first), [agents, first])
}
