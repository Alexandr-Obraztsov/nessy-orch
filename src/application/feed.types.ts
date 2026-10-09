import type { Hub } from './hub'
import type { Clock, IdGenerator, StorePort } from './ports'

export interface FeedDeps {
	hub: Hub
	store: StorePort
	clock: Clock
	ids: IdGenerator
	/** состояние изменилось — сохранить позже */
	onChange: () => void
	/** задача узла-отправителя (агента) или null — для inbox по задаче */
	taskOf: (nodeId: string) => string | null
}

export interface FeedQuery {
	/** только сообщения от/к этому узлу */
	involving?: string
	since?: number
	limit?: number
}

export interface InboxQuery {
	/** только ответы агентов этой задачи; курсор — свой для каждой задачи */
	task?: string
	wait?: number
	peek?: boolean
	after?: number
}
