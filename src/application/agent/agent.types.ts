/** Типы агента и его окружения (интерфейсы вместо циклических зависимостей). */
import type { AgentEvent, AgentStatus, Message } from '../../../shared/types'
import type { AgentIdentity, PermissionOption, TurnOutcome } from '../../domain/types'
import type { Hub } from '../hub'
import type { Clock, SpaceRuntime, StorePort } from '../ports'

/** Что агент требует от оркестратора. */
export interface AgentHost {
	getSpace(name: string): SpaceRuntime | undefined
	labelOf(id: string): string
	preambleFor(agent: AgentIdentity): string
	onTurnDone(agent: AgentIdentity, msg: Message, text: string, outcome: TurnOutcome): void
	saveSoon(): void
}

export interface AgentDeps {
	host: AgentHost
	hub: Hub
	store: StorePort
	clock: Clock
	autoApprove: boolean
	/** ожидание подтверждения отмены от nessy (мс) */
	cancelGraceMs: number
}

export interface AgentInit {
	id: string
	name: string
	space: string
	parent: string
	role?: string | null
	status?: AgentStatus
}

/** Событие агента до присвоения seq/ts. */
export type NewAgentEvent = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'seq' | 'ts'> : never) : never

/** Незавершённый блок текста/мыслей, который ещё стримится чанками. */
export interface LiveRun {
	seq: number
	ts: number
	kind: 'text' | 'thought'
	text: string
	messageId: string | null
}

export interface CurrentTurn {
	msg: Message
	promptId: string | null
	text: string
	startedAt: string
	/** ошибка хода из nessy (`nessy/error`), применяется на turn_complete */
	error: string | null
	/** отмена запрошена (cancel / прерывание новым сообщением), ждём подтверждения nessy */
	cancelRequested: boolean
	/** промпт принят nessy (отмену можно отправлять) */
	sent: boolean
}

export interface PendingPermission {
	requestId: string
	title: string
	options: PermissionOption[]
}
