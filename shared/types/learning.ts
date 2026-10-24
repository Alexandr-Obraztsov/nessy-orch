/** Контракт фонового обучения: настройки, кейсы, задания (API, SSE, приложение). */

export interface LearningSettings {
	enabled: boolean
	autoReview: boolean
	/** не используется (совместимость файла и клиентов) */
	intervalMin: number
	/** сколько мин без работы в сессии (`Stop`/`UserPromptSubmit`) делает её законченной, 5–10080 (по умолчанию 120) */
	idleMin: number
	/** сколько фоновых агентов работает одновременно, 1–6 */
	maxAgents: number
	/** пауза до повтора после ошибки задания, с: 5–3600 (по умолчанию 60) */
	retrySec: number
	/** сколько мин агент без событий считается зависшим (задание снимается и повторяется); 0 — не снимать, 0–720 (по умолчанию 20) */
	stallMin: number
	/** блок чтения сборщика: событий, 10–400 (по умолчанию 80) */
	blockEvents: number
	/** блок чтения сборщика: знаков, 4000–200000 (по умолчанию 40000) */
	blockChars: number
	/** сколько дней хранить архив сырых событий влитых целей, 0 — не хранить, 0–365 (по умолчанию 30) */
	archiveDays: number
	/** сессии, для которых обучение выключено */
	disabledSessions: string[]
}

/** Тело `POST /learning/signal`: хуки `Stop`/`UserPromptSubmit` шлют `activity`, `SessionEnd` — `end`. */
export interface LearningSignal {
	event: 'activity' | 'end'
	/** сессия оркестратора (`NESSY_ORCH_SESSION`) */
	session: string
	/** id чата Claude Code (`session_id` хука) */
	chatId?: string
	/** файл транскрипта чата (`transcript_path` хука) */
	transcriptPath?: string
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
	/** сколько целей уже влито в плейбуки и убрано из описания (нет — 0); кейс без остаточных целей удаляется */
	foldedGoals?: number
	/** всегда `live`: разбор прошлых сессий убран, поле осталось для совместимости клиентов */
	source: 'live'
}

export type JobKind = 'collect' | 'close' | 'match' | 'verify' | 'build' | 'absorb' | 'fold' | 'review' | 'judge' | 'improve' | 'edit'
/** В работе только `queued` и `running`; `done` — завершено или снято, `error` остался для старых файлов. */
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
	/** название сессии кейса = имя и заголовок агента-сборщика (у остальных заданий — null) */
	title: string | null
	/** идущее `collect`/`close`: принято событий этого задания / событий к обработке на старте задания */
	progress: { read: number; total: number } | null
	/** идущее `collect`/`close`: `reading` — агент читает блок, `summarizing` — блок выдан, описание ещё не принято; иначе null */
	phase?: 'reading' | 'summarizing' | null
	createdAt: string
	startedAt: string | null
	finishedAt: string | null
}

/** Задание и ответы его агентов из `runs/` по порядку вызова (`GET /learning/jobs/:id`). */
export interface JobDetail {
	job: JobView
	/** `name` — `<jobId>-<k>`, порядок по `k` */
	runs: Array<{ name: string; text: string }>
}

/** Вид события в `raw/events.jsonl` кейса. */
export type RawKind = 'user' | 'claude' | 'task' | 'reply' | 'call' | 'skill'

/** Событие кейса со своей сквозной нумерацией `n` (`GET /learning/cases/:id/raw`). */
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

/** Что потеряет доказательство при удалении кейса (`GET /learning/cases/:id/impact`). */
export interface CaseImpact {
	rules: Array<{ playbookId: string; ruleId: string; text: string; evidenceLeft: number }>
}

export interface LearningView {
	settings: LearningSettings
	jobs: JobView[]
	cases: CaseView[]
	playbooks: PlaybookView[]
	/** последние 300 записей */
	journal: JournalEntry[]
	/** номер шины (`hub.rev`) на момент сборки ответа: события с `rev` не больше него уже учтены */
	rev: number
}

/** Кейс с описанием сессии и заметками (`GET /learning/cases/:id`). */
export interface CaseDetail extends CaseView {
	summary: string
	/** sha1 (hex) текущего `summary.md`: `base` для `PUT /learning/cases/:id/summary` */
	summaryHash: string
	notes: string
	/** черновик описания, который агент-сборщик сохранил по ходу чтения (пусто — нет) */
	draft: string
	/** прогресс чтения идущего задания сбора или null */
	progress: { read: number; total: number } | null
}

/** Блок событий кейса для агента-сборщика (`GET /learning/cases/:id/read`). Следующий блок выдаётся только после принятого описания предыдущего. */
export interface CaseReadBlock {
	/** события блока (`[n] …`); у `done` пусто */
	text: string
	/** `BLOCK k (n a–b), events x/total acknowledged`; у `done` пусто */
	header: string
	/** карточка протокола (чек-лист) или, у `done`, инструкция сдать `case draft --final` */
	card: string
	from: number
	until: number
	/** событий к обработке на старте задания */
	total: number
	/** сколько событий ещё не выдано после этого блока */
	remaining: number
	/** все блоки приняты: осталась итоговая консолидация */
	done: boolean
}

/** Ответ на принятое описание (`POST /learning/cases/:id/draft`); отказ — 422 `rejected` с текстом `REJECTED (attempt N/3): …`. */
export interface CaseDraftResult {
	ok: true
	final: boolean
	/** принятый блок (у `final` — последний) */
	accepted: { from: number; until: number }
	/** сколько событий ещё не выдано */
	remaining: number
	message: string
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
	/** кто добавил правило; `user` — вручную в документе плейбука; нет — собрано обучением */
	author?: string
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

/** Инструмент плейбука: скрипт `tools/<name>` рядом со скиллом; создаётся сборщиком, патчем не меняется. */
export interface PlaybookTool {
	/** имя файла: `^[a-z0-9][a-z0-9._-]{0,63}$` */
	name: string
	/** что делает и как вызывать */
	description: string
	content: string
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
	/** «основан на сессии»: название сессии и дата (раздел `## Based on` документа) */
	basedOn?: Array<{ session: string; date: string }>
	files: string[]
	behavior: string[]
	stages: PlaybookStage[]
	rules: RuleView[]
	/** скрипты `tools/*` (сервер всегда отдаёт массив; у старых данных поля нет — это `[]`) */
	tools?: PlaybookTool[]
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
	/** все файлы плейбука из хранилища: `SKILL.md`, `stages/*`, `rules.md`, `tools/*`, `notes.md`, `CHANGELOG.md` (не `files`: так уже называется список ключевых файлов в `PlaybookView`) */
	fileTexts: Record<string, string>
	notes: string
	/** документ плейбука целиком (markdown): правится и сохраняется через `PUT /learning/playbooks/:id/markdown` */
	markdown: string
	changelog: string
	versions: Array<{ version: number; ts: string; message: string }>
	reviews: ReviewReport[]
}

export interface JournalEntry {
	id: string
	ts: string
	kind: 'playbook_created' | 'review_passed' | 'review_failed' | 'published' | 'trial_passed' | 'trial_failed' | 'rule_activated' | 'rule_archived' | 'version' | 'reverted' | 'edit' | 'log'
	/** уровень строки `log`; нет — `info` */
	level?: 'info' | 'warn' | 'error'
	/** id кейса или плейбука; у общей строки `log` — пусто */
	subject: string
	/** у `log` — полная фраза для человека (названия сессий и плейбуков, не id) */
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

/** Карточка кейса или плейбука для обзора сопоставителя (`GET /learning/cards`): plain text, кейс ≤ 500 знаков, плейбук ≤ 600. */
export interface LearningCard {
	id: string
	card: string
}

/** Все карточки: кейсы `ready` (по свежести) и плейбуки. */
export interface LearningCards {
	cases: LearningCard[]
	playbooks: LearningCard[]
}
