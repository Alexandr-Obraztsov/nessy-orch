import type { AgentStatus, SpaceStatus } from '@contract'

export interface StatusMeta {
	label: string
	/** CSS-переменная цвета */
	color: string
	/** анимировать индикатор (агент что-то делает) */
	pulse: boolean
}

export const AGENT_STATUS: Record<AgentStatus, StatusMeta> = {
	starting: { label: 'запускается', color: 'var(--st-starting)', pulse: true },
	idle: { label: 'свободен', color: 'var(--st-idle)', pulse: false },
	working: { label: 'работает', color: 'var(--st-working)', pulse: true },
	error: { label: 'ошибка', color: 'var(--st-error)', pulse: false },
	dead: { label: 'остановлен', color: 'var(--st-dead)', pulse: false },
	sleeping: { label: 'спит', color: 'var(--st-sleeping)', pulse: false },
}

export const SPACE_STATUS: Record<SpaceStatus, StatusMeta> = {
	stopped: { label: 'остановлен', color: 'var(--st-sleeping)', pulse: false },
	starting: { label: 'запускается', color: 'var(--st-starting)', pulse: true },
	ready: { label: 'готов', color: 'var(--st-idle)', pulse: false },
	failed: { label: 'сбой', color: 'var(--st-error)', pulse: false },
}

/** Агент принимает сообщения (dead — нет). */
export const canMessage = (s: AgentStatus): boolean => s !== 'dead'
/** У агента идёт ход, который можно прервать. */
export const canCancel = (s: AgentStatus): boolean => s === 'working' || s === 'starting'
