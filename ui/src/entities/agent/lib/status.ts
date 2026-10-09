import type { SpaceStatus } from '@contract'

export interface StatusMeta {
	label: string
	/** CSS-переменная цвета */
	color: string
	/** анимировать индикатор (что-то происходит) */
	pulse: boolean
}

/** Статусы nessy serve пространства (справочник «Пространства»). */
export const SPACE_STATUS: Record<SpaceStatus, StatusMeta> = {
	stopped: { label: 'остановлен', color: 'var(--status-idle)', pulse: false },
	starting: { label: 'запускается', color: 'var(--status-working)', pulse: true },
	ready: { label: 'готов', color: 'var(--status-done)', pulse: false },
	failed: { label: 'сбой', color: 'var(--status-error)', pulse: false },
}
