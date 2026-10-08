import { useMemo } from 'react'
import { useStore } from '@/shared/model'
import { buildTasks } from '../lib/build'
import type { Task } from './types'

/** Все поручения (реактивно, без фильтров). */
export function useTasks(): Task[] {
	const agents = useStore(s => s.agents)
	const messages = useStore(s => s.messages)
	return useMemo(() => buildTasks(agents, messages), [agents, messages])
}
