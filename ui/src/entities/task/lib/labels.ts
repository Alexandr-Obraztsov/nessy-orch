import type { AgentState } from '@/entities/agent'
import { plural } from '@/shared/lib/plural'
import type { TaskProgress, TaskStatus } from '../model/types'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
	attention: 'ждёт вас',
	error: 'ошибка',
	working: 'в работе',
	paused: 'пауза',
	done: 'готово',
}

/** Иконка сводного статуса поручения — та же, что у агента в таком состоянии. */
export const TASK_STATUS_ICON: Record<TaskStatus, AgentState> = {
	attention: 'wait',
	error: 'error',
	working: 'working',
	paused: 'idle',
	done: 'done',
}

/** «3/5 шагов плана» / «завершено агентов 2 из 3». */
export function progressText(p: TaskProgress): string {
	return p.kind === 'plan' ? `${p.done}/${p.total} шагов плана` : `завершено агентов ${p.done} из ${p.total}`
}

export const agentsText = (n: number): string => plural(n, 'агент', 'агента', 'агентов')
