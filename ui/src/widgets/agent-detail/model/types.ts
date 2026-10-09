import type { AgentEvent, AgentView, PermissionEvent, ToolEvent } from '@contract'
import type { AgentState, AgentStreamState } from '@/entities/agent'

export interface AgentDetailProps {
	agentId: string
	/** закрыть панель (крестик, Esc, клик по затемнению на телефоне) */
	onClose: () => void
}

/** Шаг хода: вызов инструмента или ожидание разрешения. */
export type Step =
	| { kind: 'tool'; key: string; ev: ToolEvent; start: number; ms: number | null; running: boolean }
	| { kind: 'permission'; key: string; ev: PermissionEvent; start: number; ms: number | null; running: boolean }

/** Текущий (или последний) ход агента для таймлайна «Шаги». */
export interface TurnView {
	/** номер хода по порядку (с 1) */
	index: number
	start: number
	end: number
	/** ход идёт сейчас */
	running: boolean
	steps: Step[]
}

/** Источник из итогового ответа: ссылка (URL) или текстовая ссылка на код/команду. */
export type SourceChip = { kind: 'url'; label: string; href: string; host: string } | { kind: 'text'; label: string }

/** Итог ответа агента по общему формату ролей. */
export type ReplyStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'BLOCKED' | 'NEEDS_CONTEXT'

/** Ответ, разобранный для показа: текст без «Источников», источники-чипы, строка «Статус». */
export interface ParsedReply {
	body: string
	sources: SourceChip[]
	status: { code: ReplyStatus; reason: string } | null
}

export interface SectionProps {
	agent: AgentView
	state: AgentState
}

export interface DetailViewProps {
	agent: AgentView
	stream: AgentStreamState
	onClose: () => void
}

export interface StepsProps {
	stream: AgentStreamState
	running: boolean
}

export interface ResultProps {
	agent: AgentView
	/** текст последнего ответа (null — ещё не загружен / ответа нет) */
	text: string | null
}

export interface ChatProps {
	agent: AgentView
	events: AgentEvent[]
	ready: boolean
}

export interface HeaderProps extends SectionProps {
	onClose: () => void
}
