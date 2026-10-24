/** Форма состояния оркестратора в хранилище (state.json). */
import type { AgentPlan, AgentStats, Message, ReplyBrief, RuntimeId } from '../../shared/types'

export interface PersistedSpace {
	name: string
	path: string
	url: string | null
	color: number
	/** рантайм пространства; нет в старых состояниях (→ nessy-sdk) */
	runtime?: RuntimeId
	/** модель по умолчанию агентов пространства; нет в старых состояниях */
	model?: string | null
}

export interface PersistedAgent {
	id: string
	name: string
	space: string
	parent: string
	/** id сессии; нет в состояниях старых версий (→ null) */
	session?: string | null
	/** id роли; нет в состояниях старых версий */
	role?: string | null
	/** в архиве; нет в состояниях старых версий */
	archived?: boolean
	/** сессия nessy закрыта по простою; нет в старых состояниях */
	parked?: boolean
	/** ключ агента; нет в старых состояниях (получит новый) */
	key?: string
	createdAt: string
	sessionId: string | null
	/** сообщение, ход по которому шёл в момент записи (при рестарте — потерянный ход); нет в старых состояниях */
	inflight?: Message | null
	/** счётчики работы; нет в состояниях старых версий */
	stats?: AgentStats
	displayName: string | null
	/** заголовок агента; нет в старых состояниях */
	title?: string | null
	lastEventId: number | null
	introduced: boolean
	status: string
	error: string | null
	queue: Message[]
	evSeq: number
	lastActivityAt: string
	/** текст последнего ответа (для превью) */
	lastReply: string
	/** план агента; нет в состояниях старых версий */
	plan?: AgentPlan | null
	/** шаги (вызовы инструментов) текущего/последнего хода */
	turnSteps?: number
	lastTurnMs?: number | null
	/** последний ответ оператору (you) */
	replyBrief?: ReplyBrief | null
}

export interface PersistedState {
	spaces: PersistedSpace[]
	agents: PersistedAgent[]
	msgSeq: number
}
