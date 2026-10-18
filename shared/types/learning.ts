/** Контракт фонового обучения: настройки, кейсы, задания (API, SSE, приложение). */

export interface LearningSettings {
	enabled: boolean
	autoReview: boolean
	/** как часто сборщик дописывает описание сессии, мин */
	intervalMin: number
	/** сколько простоя закрывает кейс, мин */
	idleMin: number
	/** сколько фоновых агентов работает одновременно */
	maxAgents: number
	/** сессии, для которых обучение выключено */
	disabledSessions: string[]
}

export type CaseStatus = 'collecting' | 'closing' | 'ready' | 'error'

export interface CaseGoal {
	title: string
	type: string
}

export interface CaseView {
	id: string
	title: string | null
	sessions: string[]
	status: CaseStatus
	goals: CaseGoal[]
	events: number
	/** номер последнего события, учтённого в summary.md */
	coveredUntil: number
	createdAt: string
	updatedAt: string
	closedAt: string | null
	playbook: string | null
	source: 'live' | 'backfill'
}

export type JobKind = 'collect' | 'close'
export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export interface JobView {
	id: string
	kind: JobKind
	caseId: string
	status: JobStatus
	attempts: number
	agentId: string | null
	error: string | null
	note: string | null
	/** диапазон событий `n` порции */
	range: [number, number] | null
	createdAt: string
	startedAt: string | null
	finishedAt: string | null
}

export interface LearningView {
	settings: LearningSettings
	jobs: JobView[]
	cases: CaseView[]
}

/** Прошлая сессия или транскрипт, который можно разобрать задним числом. */
export interface BackfillCandidate {
	kind: 'session' | 'transcript'
	id: string
	title: string
	date: string
	size: number
}

/** Кейс с описанием сессии и заметками (`GET /learning/cases/:id`). */
export interface CaseDetail extends CaseView {
	summary: string
	notes: string
}

/** Итог запуска разбора: заведённые кейсы и пропущенные кандидаты (кейс уже есть, нет транскрипта). */
export interface BackfillResult {
	created: CaseView[]
	skipped: Array<{ id: string; reason: string }>
}
