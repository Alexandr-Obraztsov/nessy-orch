/** Вкладка главной панели (как вкладки заметок в Obsidian). */
export type Tab =
	| { kind: 'feed' }
	| { kind: 'graph' }
	| { kind: 'agent'; id: string }
	/** id = null — новая роль */
	| { kind: 'role'; id: string | null }

export type DialogKind = 'spawn' | 'space' | null

/** Что показывать в общей ленте помимо ваших сообщений и итоговых ответов агентов. */
export interface FeedOptions {
	/** переписка агент → агент */
	agentChatter: boolean
	/** системные события (создан, удалён, ошибки доставки) */
	system: boolean
}

export interface ViewState {
	tabs: Tab[]
	/** индекс активной вкладки в tabs */
	active: number
	/** левая панель (на узких экранах — выезжающая) */
	sidebarOpen: boolean
	dialog: DialogKind
	/** предвыбор для диалога создания агента */
	spawnPreset: { space?: string; role?: string } | null
	feed: FeedOptions
}
