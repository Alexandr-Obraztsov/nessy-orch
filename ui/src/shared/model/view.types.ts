export type MobileTab = 'graph' | 'agents' | 'feed' | 'chat'
export type DialogKind = 'spawn' | 'space' | null
export type FeedFilter = 'all' | 'you' | 'agents' | 'system'

export interface ViewState {
	/** открытый чат агента (правая панель / вкладка «чат» на мобильных) */
	selectedAgentId: string | null
	/** активная вкладка на узких экранах */
	mobileTab: MobileTab
	dialog: DialogKind
	feedFilter: FeedFilter
}
