import type { Message } from '@contract'

export type FeedRow =
	| { t: 'day'; key: string; label: string }
	/** системное событие (только при включённых «Системных») */
	| { t: 'event'; key: string; msg: Message }
	/** ваше сообщение агенту */
	| { t: 'mine'; key: string; msg: Message; answered: boolean }
	/** сообщение агента: итоговый ответ вам или переписка агентов */
	| { t: 'agent'; key: string; msg: Message; quote: Message | null }

export interface MineRowProps {
	msg: Message
	/** на сообщение уже пришёл ответ */
	answered: boolean
	enter: boolean
}

export interface AgentCardProps {
	msg: Message
	/** исходное сообщение, на которое это ответ */
	quote: Message | null
	enter: boolean
}

export interface FeedEventProps {
	msg: Message
	enter: boolean
}

export interface FeedHeaderProps {
	count: number
}

export interface FeedEmptyProps {
	/** в ленте есть сообщения, но все скрыты настройками */
	hidden: boolean
}

/** Как закончился ход, породивший ответ. */
export type ReplyOutcome = 'ok' | 'failed' | 'interrupted' | 'message'

export interface FeedToggle {
	key: 'agentChatter' | 'system'
	label: string
	hint: string
}
