import type { Evidence, PlaybookTool, PlaybookView } from '../../shared/types'

/** Группа кейсов одной задачи — результат сопоставителя. */
export interface MatchGroup {
	task: string
	taskType: string
	/** плейбук, к которому группа относится (дополнение), или null — нужен новый */
	playbookId: string | null
	cases: Evidence[]
}

/** Черновик плейбука от сборщика: всё содержимое `PlaybookView` от `title` до `rules`, правила без счётчиков. */
export interface BuildDraft {
	title: string
	description: string
	taskType: string
	cases: string[]
	heldOut: string | null
	params: PlaybookView['params']
	sources: string[]
	files: string[]
	behavior: string[]
	stages: PlaybookView['stages']
	rules: Array<{ text: string; stage: number | null; evidence: Evidence[] }>
	/** скрипты `tools/*`; нет — `[]` */
	tools?: PlaybookTool[]
}

/** Вердикт судьи по правилу в одном кейсе. */
export interface RuleVerdict {
	ruleId: string
	verdict: 'applied' | 'violated_by_user_correction' | 'not_applicable'
	/** якорь вида `n a–b` */
	anchor: string | null
}

/** Разбор улучшателя: причина, правки файлов и новые правила-кандидаты. */
export interface Improvement {
	cause: 'gap' | 'error' | 'non_compliance' | 'one_off'
	edits: Array<{ file: string; before: string; after: string; anchor: string }>
	candidates: Array<{ text: string; stage: number | null; evidence: Evidence[] }>
}

export interface LintIssue {
	level: 'critical' | 'note'
	where: string
	text: string
}

/** Файлы плейбука: относительный путь → текст. */
export type PlaybookFiles = Record<string, string>

/**
 * Поисковый индекс BM25 (`learning-search.ts`, задача 3): документ — id, частоты слов `tf`
 * и длина в словах `len`; `df` — в скольких документах встретилось слово; `avgLen` — средняя длина.
 */
export interface SearchIndex {
	docs: Array<{ id: string; tf: Map<string, number>; len: number }>
	df: Map<string, number>
	avgLen: number
}

/** Произвольный JSON-объект (разбор ответов агентов). */
export type JsonObject = Record<string, unknown>

/** Плейбук с вердиктами судьи по кейсам (в приложении — `PlaybookState`). */
export type WithVerdicts = PlaybookView & { verdicts: Record<string, RuleVerdict[]> }

/** Диапазон номеров событий кейса (якорь `n a–b`), границы включительно. */
export interface Range {
	from: number
	to: number
}
