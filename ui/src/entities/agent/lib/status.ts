import type { AgentStatus, AgentView, SpaceStatus } from '@contract'

export interface StatusMeta {
	label: string
	/** CSS-переменная цвета */
	color: string
	/** анимировать индикатор (агент что-то делает) */
	pulse: boolean
}

export const AGENT_STATUS: Record<AgentStatus, StatusMeta> = {
	starting: { label: 'запускается', color: 'var(--st-starting)', pulse: true },
	working: { label: 'работает', color: 'var(--st-working)', pulse: true },
	idle: { label: 'свободен', color: 'var(--st-idle)', pulse: false },
	error: { label: 'ошибка', color: 'var(--st-error)', pulse: false },
}

/** Отображение агента в архиве (статус сервера при этом обычно idle). */
export const ARCHIVED_STATUS: StatusMeta = { label: 'в архиве', color: 'var(--st-archived)', pulse: false }

/** Статус для показа: архивный агент выглядит «погашенным», пока не начнёт работать снова. */
export function agentStatusMeta(a: Pick<AgentView, 'status' | 'archived'>): StatusMeta {
	if (a.archived && a.status !== 'working' && a.status !== 'starting') return ARCHIVED_STATUS
	return AGENT_STATUS[a.status]
}

export const SPACE_STATUS: Record<SpaceStatus, StatusMeta> = {
	stopped: { label: 'остановлен', color: 'var(--st-archived)', pulse: false },
	starting: { label: 'запускается', color: 'var(--st-starting)', pulse: true },
	ready: { label: 'готов', color: 'var(--st-idle)', pulse: false },
	failed: { label: 'сбой', color: 'var(--st-error)', pulse: false },
}

/** Агент принимает сообщения: всегда (архивного сообщение возвращает в работу). */
export const canMessage = (_s: AgentStatus): boolean => true
/** У агента идёт ход, который можно прервать. */
export const canCancel = (s: AgentStatus): boolean => s === 'working' || s === 'starting'
/** Агент занят (для сортировки и счётчиков). */
export const isBusy = (a: Pick<AgentView, 'status'>): boolean => a.status === 'working' || a.status === 'starting'
