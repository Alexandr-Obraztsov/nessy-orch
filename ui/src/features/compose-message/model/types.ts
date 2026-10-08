import type { AgentView } from '@contract'

export interface ComposerProps {
	/** фиксированный получатель (чат агента); без него — выбор адресата (лента) */
	to?: string
	/** после успешной отправки (например, прокрутить вниз) */
	onSent?: () => void
	/**
	 * Галочка «прервать текущий ход», пока адресат работает (по умолчанию включена).
	 * Снята — сообщение встаёт в очередь (`interrupt: false`).
	 */
	interruptToggle?: boolean
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
	/** прерывать текущий ход адресата при отправке */
	interrupt: boolean
	setInterrupt: (v: boolean) => void
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
