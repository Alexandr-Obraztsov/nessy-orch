import type { Evidence, PlaybookTool, PlaybookView } from '../../shared/types'

/** Группа кейсов одной задачи — результат сопоставителя. */
export interface MatchGroup {
	task: string
	taskType: string
	/** плейбук, к которому группа относится (дополнение), или null — нужен новый */
	playbookId: string | null
	cases: Evidence[]
}

/** Что сопоставитель предлагает сделать с группой пар «сессия + цель». */
export type MatchAction = 'new_playbook' | 'add_to_playbook' | 'merge_into_playbook' | 'merge_case_and_playbook'

/** Член группы: цель сессии (по названию) и якоря её общей части. */
export interface GroupMember {
	caseId: string
	/** название цели (`## Goal: <title>`) в описании сессии */
	goal: string
	/** якоря вида `n a–b` */
	anchors: string[]
}

/** Решение сопоставителя по одной группе. */
export interface MatchDecision {
	task: string
	taskType: string
	action: MatchAction
	/** плейбук, к которому относится группа; у `new_playbook` — null */
	playbookId: string | null
	members: GroupMember[]
	reason: string
}

/** Вердикт второго прохода по группе. */
export interface GroupVerdict {
	verdict: 'confirm' | 'reject' | 'split'
	reason: string
	/** при `split` — какие члены остаются (`caseId` + `goal`) */
	members?: Array<{ caseId: string; goal: string }>
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
	rules: Array<{ text: string; stage: number | null; evidence: Evidence[]; /** id правила существующего плейбука, которое сборщик сохраняет или правит (`absorb`) */ id?: string }>
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

/** Результат разбора markdown-документа плейбука: поля содержания и сверка правил с прежним состоянием. */
export interface ParsedDocument {
	title: string
	description: string
	taskType: string
	params: PlaybookView['params']
	sources: string[]
	files: string[]
	behavior: string[]
	stages: PlaybookView['stages']
	/** правила прежнего состояния с учётом документа: правка текста/этапа/раздела, новые архивные; порядок прежний */
	rules: PlaybookView['rules']
	/** новые правила (строки без маркера), без id */
	added: Array<{ text: string; stage: number | null; status: 'active' | 'candidate' }>
	/** id правил, которые архивированы этим документом (маркер пропал) */
	archived: string[]
	/** `## Notes` вместе с незнакомыми разделами */
	notes: string
}

/** `issues` — ошибки (документ не применяется), `notices` — замечания, которые применению не мешают. */
export interface ParseResult {
	draft: ParsedDocument
	issues: string[]
	notices: string[]
}
