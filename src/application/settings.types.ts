/** Настройки, нужные прикладному слою (подмножество полной конфигурации). */
export interface OrchSettings {
	/** каталог состояния */
	home: string
	/** автоподтверждение прав агентов */
	autoApprove: boolean
	/** защита от зацикливания межагентной переписки */
	maxHops: number
	rateLimitPerMinute: number
	/** путь к CLI для вводной агентов */
	cliPath: string
	/** сколько ждать подтверждения отмены хода от nessy, прежде чем продолжить без него (мс, по умолчанию 3000) */
	cancelGraceMs?: number
}
