/**
 * Состояние агента для показа: wait — ждёт вашего разрешения, done — закончил задачу (ответил / в архиве),
 * idle — свободен без итогового ответа (ждёт поручения или очередь сообщений).
 */
export type AgentState = 'wait' | 'error' | 'working' | 'starting' | 'idle' | 'done'

/** Прогресс по плану агента: сколько шагов сделано, какой идёт сейчас. */
export interface PlanProgress {
	done: number
	total: number
	/** индекс шага в работе (in_progress) или -1 */
	active: number
	/** текст шага в работе (или null) */
	step: string | null
}

/** Инструмент для показа в стиле Claude Code: «⏺ Bash  npm test». */
export interface ToolView {
	/** короткое имя: Bash, Read, Edit, Grep, WebFetch, gitlab · get_mr … */
	name: string
	/** главный аргумент: команда, путь, шаблон, URL (или заголовок) */
	arg: string
}
