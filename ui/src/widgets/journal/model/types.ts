/** Тип записи журнала (фильтр). */
export type JournalType = 'msg' | 'reply' | 'error' | 'system'

export interface JournalEntry {
	id: string
	seq: number
	ts: number
	type: JournalType
	from: string
	to: string
	text: string
	/** агент, чьи детали открыть по клику (или null) */
	agentId: string | null
}

export interface JournalFilter {
	type: JournalType | 'all'
	/** id агента или '' */
	agent: string
	/** id агентов выбранного поручения (null — все) */
	task: Set<string> | null
	query: string
}

export interface JournalProps {
	/** drawer — нижний ящик (десктоп), full — на весь экран (мобильная вкладка) */
	mode: 'drawer' | 'full'
}
