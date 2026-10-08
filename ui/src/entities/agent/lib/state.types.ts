/** Состояние агента для показа: wait — ждёт вашего разрешения, done — ответил / в архиве, idle — пауза. */
export type AgentState = 'wait' | 'error' | 'working' | 'starting' | 'idle' | 'done'

export type ActionTone = 'wait' | 'error' | 'done' | 'muted'

/** Текущее действие агента одной строкой. */
export interface AgentAction {
	text: string
	tone: ActionTone
}
