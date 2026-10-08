/** Форма состояния оркестратора в хранилище (state.json). */
import type { Message } from '../../shared/types'

export interface PersistedSpace {
	name: string
	path: string
	url: string | null
	color: number
}

export interface PersistedAgent {
	id: string
	name: string
	space: string
	parent: string
	/** id роли; нет в состояниях старых версий */
	role?: string | null
	/** в архиве; нет в состояниях старых версий */
	archived?: boolean
	createdAt: string
	sessionId: string | null
	displayName: string | null
	lastEventId: number | null
	introduced: boolean
	status: string
	error: string | null
	queue: Message[]
	evSeq: number
	lastActivityAt: string
	lastReply: string
}

export interface PersistedState {
	spaces: PersistedSpace[]
	agents: PersistedAgent[]
	msgSeq: number
	inboxCursor: number
}
