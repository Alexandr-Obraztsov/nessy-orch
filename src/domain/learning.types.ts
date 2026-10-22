import type { CaseGoal, RawEvent, RawKind } from '../../shared/types'

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
	summary: string
	notes: string
	/** событий в кейсе после `coveredUntil` */
	total: number
	/** сессия закончилась: дописать все разделы */
	final: boolean
}

/** Разобранный ответ сборщика. */
export interface CollectorResult {
	summary: string
	title: string | null
	goals: CaseGoal[]
}
