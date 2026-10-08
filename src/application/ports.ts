/**
 * Порты прикладного слоя: что ядру нужно от внешнего мира (nessy, процессы, хранилище, часы, id).
 * Только типы — реализации живут в infrastructure/ и подключаются в src/main.ts.
 */
import type { AgentEvent, Message, PlanEntry, RoleView, SpaceStatus, SpaceView, ToolStatus } from '../../shared/types'
import type { PermissionOption, RolePresetFile } from '../domain/types'
import type { PersistedState } from './persisted.types'

// ---------- nessy ----------
/** Нормализованное событие сессии nessy (стабильная внутренняя форма, не зависит от протокола). */
export type SessionEvent =
	| { kind: 'text' | 'thought'; text: string; messageId: string | null }
	/** Полное (слитое по toolCallId) состояние вызова инструмента. */
	| {
			kind: 'tool'
			toolId: string
			name: string
			title: string
			input: Record<string, unknown>
			status: ToolStatus
			output: string
	  }
	| { kind: 'turn_complete'; stopReason: string; promptId: string | null }
	/** Ошибка хода (обычно следом придёт turn_complete). */
	| { kind: 'turn_error'; message: string; retryable: boolean; code: number | null }
	| { kind: 'cancelled'; promptId: string | null }
	| { kind: 'meta'; displayName: string }
	| { kind: 'permission'; requestId: string; options: PermissionOption[]; title: string }
	| { kind: 'followup'; text: string }
	/** План агента целиком (ACP `plan`): каждое обновление заменяет прежний. */
	| { kind: 'plan'; entries: PlanEntry[] }
	| { kind: 'died'; reason: string }
	| { kind: 'evicted' }

export interface SessionSubscription {
	close(): void
}

export interface SubscribeOptions {
	lastEventId: number | null
	onEvent: (ev: SessionEvent, eventId: number | null) => void
	onState?: (s: 'open' | 'reconnecting') => void
}

/** Шлюз к одному `nessy serve`. */
export interface NessyGateway {
	health(): Promise<boolean>
	createSession(cwd: string): Promise<{ sessionId: string }>
	/** Поднять сессию после рестарта. true — если получилось. */
	resumeSession(sessionId: string, cwd: string): Promise<boolean>
	prompt(sessionId: string, text: string): Promise<{ promptId: string | null }>
	cancel(sessionId: string): Promise<void>
	closeSession(sessionId: string): Promise<void>
	/** Проголосовать по запросу разрешения (optionId=null → отмена). */
	vote(sessionId: string, requestId: string, optionId: string | null): Promise<void>
	subscribe(sessionId: string, opts: SubscribeOptions): SessionSubscription
}

// ---------- пространства ----------
export interface SpaceInit {
	name: string
	path: string
	url?: string | null
	color?: number
}

export interface SpaceExitInfo {
	intended: boolean
	code: number | null
	signal: string | null
}

export interface SpaceListener {
	onStatus(space: SpaceRuntime): void
	onExit(space: SpaceRuntime, info: SpaceExitInfo): void
}

/** Пространство: воркспейс + (managed) процесс nessy serve либо внешний демон (external). */
export interface SpaceRuntime {
	readonly name: string
	readonly path: string
	readonly url: string | null
	readonly color: number
	/** true — процесс serve запускает и останавливает оркестратор (нет url) */
	readonly managed: boolean
	readonly status: SpaceStatus
	readonly client: NessyGateway | null
	/** Гарантировать, что nessy serve поднят. */
	ensureReady(): Promise<NessyGateway>
	stop(): Promise<void>
	toJSON(): SpaceView
}

export type SpaceFactory = (init: SpaceInit, listener: SpaceListener) => SpaceRuntime

// ---------- хранилище ----------
export interface StorePort {
	loadState(): PersistedState
	/** Отложенная атомарная запись состояния. */
	saveStateSoon(getState: () => PersistedState): void
	/** Немедленно записать отложенное состояние. */
	flush(): void
	appendMessage(m: Message): void
	loadMessages(limit: number): Message[]
	appendEvent(agentId: string, ev: AgentEvent): void
	readEvents(agentId: string, limit: number): AgentEvent[]
	/** Есть ли уже файл ролей (даже пустой): первый запуск или нет. */
	hasRoles(): boolean
	loadRoles(): RoleView[]
	/** Немедленная атомарная запись ролей (меняются редко). */
	saveRoles(roles: readonly RoleView[]): void
	/** Историю не удаляем: архивируем. */
	archiveAgent(agentId: string): void
	/** Записать отложенное и больше ничего не писать (остановка). */
	close(): void
}

// ---------- время и идентификаторы ----------
export interface Clock {
	now(): number
}

export interface IdGenerator {
	/** Короткий случайный идентификатор длины `len`. */
	next(len: number): string
}

// ---------- пресеты ролей ----------
/** Источник готовых ролей (markdown-файлы); разбор и проверка — в domain/role-presets. */
export interface RolePresetSource {
	read(): RolePresetFile[]
}
