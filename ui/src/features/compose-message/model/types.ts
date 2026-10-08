import type { AgentView } from '@contract'

export interface ComposerProps {
	/** фиксированный получатель (чат агента); без него — выбор адресата (лента) */
	to?: string
	/** почему отправка недоступна (агент остановлен и т.п.) */
	disabledReason?: string | null
	placeholder?: string
	/** после успешной отправки (например, прокрутить вниз) */
	onSent?: () => void
}

export interface MentionMatch {
	agent: AgentView
	/** текст без префикса «@имя » */
	rest: string
}

export interface ComposerModel {
	text: string
	setText: (v: string) => void
	/** текущий адресат (id агента) или null, если писать некому */
	recipient: string | null
	pick: (id: string) => void
	/** агенты, которым можно писать */
	targets: AgentView[]
	sending: boolean
	send: () => Promise<void>
	/** подсказки при наборе «@…» в начале */
	suggestions: AgentView[]
	complete: (agent: AgentView) => void
}
