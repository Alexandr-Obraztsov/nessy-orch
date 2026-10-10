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
	/** Ход завершён: опубликовать ответ отправителю. Возвращает опубликованный ответ (или null). */
	onTurnDone(agent: AgentIdentity, msg: Message, text: string, outcome: TurnOutcome): Message | null
	/** Ссылки из вызова инструмента агента → источники его сессии. */
	onToolUrls(agent: AgentIdentity, urls: readonly string[]): void
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
	/** базовая пауза повтора промпта при временном отказе nessy (мс, растёт вдвое); по умолчанию 1000 */
	promptRetryBaseMs?: number
	/** команда CLI оркестратора (для напоминания о плане в промпте) */
	cliPath: string
}

export interface AgentInit {
	id: string
	name: string
	space: string
	parent: string
	/** id сессии (null — вне сессий) */
	session?: string | null
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
	/** блоки текста хода по порядку; новый блок — при смене messageId или после вызова инструмента */
	texts: string[]
	/** messageId последнего текстового чанка */
	textMsgId: string | null
	/** после последнего текстового чанка был вызов инструмента: следующий чанк начинает новый блок */
	textBreak: boolean
	/** агент опубликовал план в этом ходе */
	planned: boolean
	/** предупреждение «нет плана» уже выдано в этом ходе */
	planWarned: boolean
	startedAt: string
	/** начало хода, мс (для lastTurnMs) */
	startedMs: number
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
