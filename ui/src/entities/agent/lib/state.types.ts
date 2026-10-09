/**
 * Состояние агента для показа: wait — ждёт вашего разрешения, done — закончил задачу (ответил / в архиве),
 * idle — свободен без итогового ответа (ждёт поручения или очередь сообщений).
 */
export type AgentState = 'wait' | 'error' | 'working' | 'starting' | 'idle' | 'done'

/** Группа таблицы: «Работают» или «Выполнено». */
export type AgentGroup = 'work' | 'done'

/** Прогресс по плану агента: сколько шагов сделано, какой идёт сейчас. */
export interface PlanProgress {
	done: number
	total: number
	/** индекс шага в работе (in_progress) или -1 */
	active: number
	/** текст шага в работе (или null) */
	step: string | null
}

/** Подпись инструмента из заголовка «Read: src/a.ts» → имя «Read» и аргумент «src/a.ts». */
export interface ToolLabel {
	name: string
	arg: string
}

/** Счётчики чипов-фильтров и заголовка вкладки. */
export interface StateCounts {
	all: number
	/** ждут разрешения */
	wait: number
	/** работают (группа «Работают» без ждущих и ошибок) */
	working: number
	error: number
	/** выполнено */
	done: number
}
