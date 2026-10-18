import type { CaseGoal } from '../../shared/types'

/** Вид события в `raw/events.jsonl` кейса. */
export type RawKind = 'user' | 'claude' | 'task' | 'reply' | 'call'

/** Запись транскрипта Claude Code после разбора (`transcript.ts`). */
export interface TranscriptEntry {
	uuid: string
	/** мс */
	ts: number
	kind: 'user' | 'claude' | 'call'
	text: string
}

/** Событие кейса со своей сквозной нумерацией `n`. */
export interface RawEvent {
	n: number
	ts: number
	kind: RawKind
	from: string
	to: string | null
	text: string
	/** откуда взято: id сообщения ленты или uuid записи транскрипта */
	ref: string
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
	portion: Portion
	/** сессия закончилась: дописать все разделы */
	final: boolean
}

/** Разобранный ответ сборщика. */
export interface CollectorResult {
	summary: string
	title: string | null
	goals: CaseGoal[]
}
