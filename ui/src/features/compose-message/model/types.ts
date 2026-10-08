import type { AgentView } from '@contract'

export interface ComposerProps {
	/** фиксированный получатель (чат агента); без него — выбор адресата (лента) */
	to?: string
	/** после успешной отправки (например, прокрутить вниз) */
	onSent?: () => void
}

export interface MentionMatch {
	agent: AgentView
	/** текст без префикса «@имя » */
	rest: string
}

/** Подсказка под полем ввода: что произойдёт при отправке. */
export interface ComposerHint {
	tone: 'info' | 'warn'
	text: string
}

export interface ComposerModel {
	text: string
	setText: (v: string) => void
	/** текущий адресат или null, если писать некому */
	recipient: AgentView | null
	pick: (id: string) => void
	/** активные агенты (сначала) */
	active: AgentView[]
	/** агенты в архиве — проснутся при отправке */
	archived: AgentView[]
	sending: boolean
	canSend: boolean
	send: () => Promise<void>
	/** подсказки при наборе «@…» в начале */
	suggestions: AgentView[]
	complete: (agent: AgentView) => void
}

export interface RecipientSelectProps {
	value: AgentView | null
	active: AgentView[]
	archived: AgentView[]
	onPick: (id: string) => void
}
