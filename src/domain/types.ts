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

/** Сосед агента во вводной: архивный помечается, роль — по имени. */
export interface PeerInfo extends AgentIdentity {
	archived: boolean
	roleName: string | null
}

/** Роль во вводной агента. */
export interface RoleBrief {
	name: string
	instructions: string
}

/** Поля роли после проверки (id и цвет уже вычислены). */
export interface RoleFields {
	id: string
	name: string
	description: string
	instructions: string
	color: number
}

/** Сырые поля роли из запроса (до проверки). */
export interface RoleInput {
	name: string
	description?: string
	instructions: string
	color?: number
	id?: string
}

/** Результат разбора frontmatter пресета роли. */
export interface RolePresetMeta {
	fields: Record<string, string>
	body: string
}

/** Файл пресета роли как он прочитан с диска (до разбора). */
export interface RolePresetFile {
	/** имя файла (для сообщений) */
	source: string
	text: string
}

/** Итог заливки пресетов при первом запуске. */
export interface RoleSeedResult {
	added: string[]
	invalid: string[]
}

/** Поля новой сессии после проверки (id = null — сгенерировать из заголовка). */
export interface SessionFields {
	id: string | null
	title: string
	owner: string | null
}
