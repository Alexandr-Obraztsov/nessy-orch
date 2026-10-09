import type { TaskView } from '@contract'
import { useStore } from '@/shared/model'

/** Задача по id (реактивно). */
export function useTask(id: string): TaskView | undefined {
	return useStore(s => s.tasks.find(t => t.id === id))
}
