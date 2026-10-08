/** Доменные типы ядра (без кода). */
import type { MessageKind, NodeId } from '../../shared/types'

/** Лимиты маршрутизации межагентной переписки. */
export interface RoutingLimits {
	maxHops: number
	rateLimitPerMinute: number
}

/** Черновик сообщения ленты (seq/id/ts выставляет лента). */
export interface MessageDraft {
	from: NodeId
	to: NodeId
	kind: MessageKind
	text: string
	hops?: number
	replyTo?: string
	wait?: boolean
	failed?: string
}

/** Итог хода агента. */
export interface TurnOutcome {
	error?: string
	stopReason?: string
}

/** Минимум сведений об агенте, нужный правилам маршрутизации и вводной. */
export interface AgentIdentity {
	id: string
	name: string
	space: string
}

/** Вариант ответа на запрос разрешения. */
export interface PermissionOption {
	optionId: string
	kind: string
	name: string
}
