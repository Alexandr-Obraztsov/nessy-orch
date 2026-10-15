/**
 * Порты прикладного слоя: что ядру нужно от внешнего мира (nessy, процессы, хранилище, часы, id).
 * Только типы — реализации живут в infrastructure/ и подключаются в src/main.ts.
 */
import type { AgentEvent, Message, PlanEntry, RoleView, SpaceStatus, SpaceView, SessionView, SourceView, TokenUsage, ToolStatus } from '../../shared/types'
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
	/** usage — токены хода, если nessy их сообщил */
	| { kind: 'turn_complete'; stopReason: string; promptId: string | null; usage?: TokenUsage }
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
	/** кольцо событий nessy не покрывает пропуск: часть событий потеряна (ход мог закончиться незамеченным) */
	| { kind: 'resync' }
	/** nessy забрал сообщения из очереди mid-turn в ход: модель их увидела */
	| { kind: 'injected'; count: number }

export interface SessionSubscription {
	close(): void
}

export interface SubscribeOptions {
	lastEventId: number | null
	onEvent: (ev: SessionEvent, eventId: number | null) => void
}

/** Шлюз к одному `nessy serve`. */
export interface NessyGateway {
	health(): Promise<boolean>
	createSession(cwd: string): Promise<{ sessionId: string }>
	/**
	 * Поднять закрытую (или пережившую рестарт демона) сессию вместе с контекстом модели: POST /session/:id/load.
	 * null — сессии нет (404 и т. п.). lastEventId — с него подписываться, чтобы не получить повтор истории.
	 * Пока ответ не пришёл, промпт слать нельзя (404): ждём этот вызов.
	 */
	restoreSession(sessionId: string, cwd: string): Promise<{ lastEventId: number | null } | null>
	/** Доставить сообщение в идущий ход без прерывания (POST …/mid-turn-message). false — сессия простаивает или очередь полна. */
	midTurn(sessionId: string, message: string): Promise<boolean>
	prompt(sessionId: string, text: string): Promise<{ promptId: string | null }>
	/** Токены сессии нарастающим итогом (GET /session/:id/stats); null — nessy не сообщает. */
	usage(sessionId: string): Promise<TokenUsage | null>
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
	readonly status: SpaceStatus
	readonly client: NessyGateway | null
	/** Гарантировать, что nessy serve поднят. */
	ensureReady(): Promise<NessyGateway>
	stop(): Promise<void>
	/** Синхронно послать SIGTERM своему nessy serve (на выходе процесса, когда ждать уже нельзя). */
	killSync(): void
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
	loadSessions(): SessionView[]
	/** Немедленная атомарная запись сессий (sessions.json). */
	saveSessions(sessions: readonly SessionView[]): void
	/** Источники сессии (append-only JSONL: sources/<id>.jsonl). */
	appendSource(sessionId: string, s: SourceView): void
	loadSources(sessionId: string): SourceView[]
	/** Сессию удалили: её файл источников больше не нужен. */
	removeSources(sessionId: string): void
	/** Историю не удаляем: архивируем. */
	archiveAgent(agentId: string): void
	/** Записать отложенное и больше ничего не писать (остановка). */
	close(): void
}

// ---------- пакеты ролей ----------
/** Файлы роли (скрипты, шаблоны, команды) в каталоге оркестратора: агент читает и запускает их по абсолютному пути. */
export interface RolePackagePort {
	/** Скопировать папку пакета роли `id` из `src`; возвращает путь копии. Старая копия заменяется. */
	install(id: string, src: string): string
	/** Путь копии или null, если пакета нет. */
	dirOf(id: string): string | null
	remove(id: string): void
	/** Создать пустую папку пакета (с подсказкой в README), если её нет; возвращает путь. */
	ensure(id: string): string
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
