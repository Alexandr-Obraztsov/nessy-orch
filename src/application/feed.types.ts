import type { Hub } from './hub'
import type { Clock, IdGenerator, StorePort } from './ports'

export interface FeedDeps {
	hub: Hub
	store: StorePort
	clock: Clock
	ids: IdGenerator
	/** состояние изменилось — сохранить позже */
	onChange: () => void
}

export interface FeedQuery {
	/** только сообщения от/к этому узлу */
	involving?: string
	since?: number
	limit?: number
}

export interface InboxQuery {
	wait?: number
	peek?: boolean
	after?: number
}
