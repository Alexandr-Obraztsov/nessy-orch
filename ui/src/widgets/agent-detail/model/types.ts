import type { AgentEvent, AgentView, PermissionEvent, ToolEvent } from '@contract'
import type { AgentStreamState, LiveRun } from '@/entities/agent'

export interface AgentDetailProps {
	agentId: string
	/** закрыть панель (крестик, стрелка «назад» на узких экранах) */
	onClose: () => void
}

/** Вкладки нижней части панели. */
export type DetailTab = 'result' | 'steps' | 'chat'

export type ChatRow =
	| { t: 'day'; key: string; label: string }
	| { t: 'event'; key: string; ev: AgentEvent }
	| { t: 'live'; key: string; run: LiveRun }

/** Шаг хода: вызов инструмента или ожидание разрешения. */
export type Step =
	| { kind: 'tool'; key: string; ev: ToolEvent; start: number; ms: number | null; running: boolean }
	| { kind: 'permission'; key: string; ev: PermissionEvent; start: number; ms: number | null; running: boolean }

/** Текущий (или последний) ход агента для вкладки «Шаги». */
export interface TurnView {
	/** номер хода по порядку (с 1) */
	index: number
	start: number
	end: number
	/** ход идёт сейчас */
	running: boolean
	steps: Step[]
}

/** Чип ссылки, найденной в тексте результата. */
export interface LinkChip {
	kind: 'url' | 'jira' | 'mr'
	/** что показать */
	label: string
	/** что открыть (url) или скопировать (ключ задачи, номер MR) */
	value: string
}

/** Что сейчас требует оператора в этом агенте (баннер сверху). */
export type Attention =
	| { kind: 'permission'; requestId: string; title: string; more: number }
	| { kind: 'error'; text: string }
	| { kind: 'result'; msgId: string; preview: string }

export interface DetailViewProps {
	agent: AgentView
	stream: AgentStreamState
	onClose: () => void
}

export interface StepsPaneProps {
	agent: AgentView
	stream: AgentStreamState
	durations: Map<string, number>
	running: boolean
}

export interface CloseProps {
	onClose: () => void
}

export interface HeaderProps {
	agent: AgentView
	onClose: () => void
}

export interface BannerProps {
	agent: AgentView
	attention: Attention
	/** повторить последнее сообщение (для ошибки) */
	onRetry: () => Promise<void>
	onSeen: (msgId: string) => void
	onOpenResult: () => void
}

export interface NowProps {
	agent: AgentView
	events: AgentEvent[]
	live: LiveRun[]
}

export interface PlanProps {
	agent: AgentView
}

export interface ResultTabProps {
	agent: AgentView
	/** текст последнего ответа (null — ещё не загружен / ответа нет) */
	text: string | null
}

export interface StepsTabProps {
	agent: AgentView
	turn: TurnView | null
}

export interface TimelineProps {
	turn: TurnView
	onPick: (key: string) => void
}

export interface ChatTabProps {
	agent: AgentView
	events: AgentEvent[]
	live: LiveRun[]
	ready: boolean
	durations: Map<string, number>
}

export interface ChatEventRowProps {
	ev: AgentEvent
	agent: AgentView
	enter: boolean
	/** длительность вызова инструмента, мс (если известна) */
	toolMs?: number
}

export interface ToolRowProps {
	ev: ToolEvent
	enter?: boolean
	durationMs?: number | null
	/** раскрыть принудительно (клик по сегменту таймлайна): меняющийся номер > 0 */
	forceOpen?: number
	/** номер шага в ходе */
	n?: number
}

export interface ThoughtRowProps {
	text: string
	enter: boolean
}

export interface PermissionRowProps {
	ev: PermissionEvent
	agent: AgentView
	enter?: boolean
	durationMs?: number | null
}
