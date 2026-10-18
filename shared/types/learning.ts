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

export type JobKind = 'collect' | 'close' | 'match' | 'build' | 'review' | 'judge' | 'improve' | 'edit'
export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export interface JobView {
	id: string
	kind: JobKind
	/** кейс задания (`''`, если задание не над кейсом) */
	caseId: string
	/** id объекта задания: кейс, плейбук `p-…`, группа `g-…`, `all` у сопоставителя; у collect/close равен caseId */
	subject: string
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
	playbooks: PlaybookView[]
	/** последние 200 записей */
	journal: JournalEntry[]
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

export type PlaybookStatus = 'draft' | 'review' | 'trial' | 'active' | 'disabled' | 'archived'
export type RuleStatus = 'candidate' | 'active' | 'archived'

/** Доказательство правила: кейс и якорь вида `n 12–15`. */
export interface Evidence {
	caseId: string
	anchor: string
}

export interface RuleView {
	id: string
	text: string
	stage: number | null
	status: RuleStatus
	up: number
	down: number
	evidence: Evidence[]
	against: Evidence[]
	lastAppliedAt: string | null
	createdAt: string
}

export interface PlaybookParam {
	name: string
	description: string
	source: string
}

export interface PlaybookStage {
	n: number
	slug: string
	title: string
	role: string | null
	where: string
	produce: string
	done: string
	gate: boolean
	template: string
}

/** Правка улучшателя, ожидающая решения человека (`autoReview: false`). */
export interface PendingEdit {
	hash: string
	file: string
	before: string
	after: string
	anchor: string
	caseId: string
	createdAt: string
}

export interface PlaybookView {
	id: string
	name: string
	title: string
	description: string
	taskType: string
	status: PlaybookStatus
	version: number
	cases: string[]
	heldOut: string | null
	params: PlaybookParam[]
	sources: string[]
	files: string[]
	behavior: string[]
	stages: PlaybookStage[]
	rules: RuleView[]
	trial: { before: number; cases: string[]; corrections: number[] } | null
	/** правки, ждущие решения (`autoReview: false`); у плейбуков старого формата поля нет — это `[]` */
	pendingEdits?: PendingEdit[]
	createdAt: string
	updatedAt: string
}

export type StageVerdict = 'pass' | 'fail' | 'skip'

export interface StageReport {
	stage: 1 | 2 | 3 | 4 | 5 | 6
	verdict: StageVerdict
	critical: string[]
	notes: string[]
	agentIds: string[]
}

export interface ReviewReport {
	playbookId: string
	version: number
	ts: string
	passed: boolean
	stages: StageReport[]
}

/** Плейбук с файлами-заметками и историей (`GET /learning/playbooks/:id`). */
export interface PlaybookDetail extends PlaybookView {
	notes: string
	changelog: string
	versions: Array<{ version: number; ts: string; message: string }>
	reviews: ReviewReport[]
}

export interface JournalEntry {
	id: string
	ts: string
	kind: 'playbook_created' | 'review_passed' | 'review_failed' | 'published' | 'trial_passed' | 'trial_failed' | 'rule_activated' | 'rule_archived' | 'version' | 'reverted' | 'edit'
	subject: string
	summary: string
	report: string | null
	revertible: boolean
	revertedBy: string | null
}

export interface ChatMessage {
	id: string
	ts: string
	from: 'user' | 'agent'
	text: string
	changes: string[]
}
