export interface Counters {
	/** агенты, кроме остановленных */
	active: number
	total: number
	dead: number
	/** работают или запускаются */
	working: number
	/** число ожидающих запросов разрешений */
	permissions: number
	/** первый агент, ждущий разрешения (для перехода по клику) */
	firstPermissionAgent: string | null
}

/** Этап удаления пространства. */
export type RemoveStage = 'idle' | 'confirm' | 'busy' | 'force' | 'forceBusy'
