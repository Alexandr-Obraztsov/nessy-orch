import type { RawEvent, RawKind } from '../../shared/types'

// вид и само событие кейса — часть контракта с клиентами
export type { RawEvent, RawKind }

/** Запись транскрипта Claude Code после разбора (`transcript.ts`). */
export interface TranscriptEntry {
	uuid: string
	/** мс */
	ts: number
	kind: 'user' | 'claude' | 'call' | 'skill'
	text: string
}

/** Порция событий для сборщика: готовый текст и границы `n`. */
export interface Portion {
	text: string
	from: number
	until: number
}

/** Вход сборщика сессии. */
export interface CollectorInput {
	caseId: string
	/** название сессии кейса: первая строка описания `# <название>` */
	sessionTitle: string
	summary: string
	notes: string
	/** событий в кейсе после `coveredUntil` */
	total: number
	/** сессия закончилась: дописать все разделы */
	final: boolean
	/** событий в блоке чтения (настройка `blockEvents`); нет — умолчание */
	blockEvents?: number
}

/** Нарушение проверки описания (`summary-gate`): код правила и что именно не так. */
export interface GateIssue {
	code: string
	text: string
	/** предупреждение: описание принимается с пометкой, отказа нет */
	soft?: boolean
}

/** Вход проверки описания к блоку событий. */
export interface GateInput {
	/** предлагаемое полное описание */
	text: string
	/** предыдущее принятое описание ('' — первого нет) */
	prev: string
	/** события выданного блока */
	events: readonly RawEvent[]
	/** границы блока: `from..until` (`until` — и верхняя граница допустимых якорей) */
	from: number
	until: number
}
