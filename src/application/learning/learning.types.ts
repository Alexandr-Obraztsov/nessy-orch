import type { CaseView, JobView, JournalEntry, Message, PlaybookView, RawEvent, SessionView } from '../../../shared/types'
import type { RuleVerdict } from '../../domain/playbook.types'
import type { Clock, IdGenerator, LearningStorePort, PlaybookStorePort } from '../ports'
import type { Hub } from '../hub'

/** Где остановилось чтение транскрипта Claude Code. */
export interface TranscriptCursor {
	path: string
	/** смещение в байтах: только по целым строкам */
	offset: number
}

/** Кейс на диске: видимая часть и служебное состояние сбора. */
export interface CaseState extends CaseView {
	/** сколько событий ленты уже учтено */
	feedSeq: number
	/** курсоры транскриптов по id чата Claude Code */
	transcripts: Record<string, TranscriptCursor>
	/** следующий номер события */
	nextN: number
	lastEventAt: number
	lastRunAt: number
	nessyCalls: boolean
	/** плейбуки, уже подсказанные в этой цепочке сессий (хук UserPromptSubmit) */
	hinted: string[]
	/** сколько заданий подряд исчерпали отказы на блоке, начинающемся с `from` (нет — 0; сбрасывается принятием блока): лестница смягчения гейта */
	blockFails?: { from: number; fails: number }
	/** корень цепочки при заведении кейса (корень мог быть удалён; нет в старых — первый из `sessions`) */
	rootId?: string
}

/** Служебное состояние обучения (`<home>/learning/meta.json`). */
export interface LearningMeta {
	/** когда сервис обучения запущен впервые: сессии старше точки отсчёта живых кейсов не заводят */
	startedAt: number
	/** `seq` ленты на тот момент: раньше него живой сбор не читает */
	startSeq: number
	/** надгробия: id удалённых кейсов-цепочек, которые не воскресают */
	removed: string[]
	/** окончательные провалы сборки: по ним `match` не повторяет сборку той же группы сутки */
	failedBuilds?: FailedBuild[]
	/** когда последний раз пересчитывались счётчики правил (затухание), мс */
	lastRecountAt?: number
}

/** Окончательно проваленная сборка: хэш группы, её кейсы и время провала. */
export interface FailedBuild {
	hash: string
	cases: string[]
	at: number
}

export type JobState = Omit<JobView, 'progress' | 'phase' | 'title' | 'retryAt' | 'waiting'> & {
	/** название сессии кейса = имя агента-сборщика (нет — null) */
	title?: string | null
	final: boolean
	/** когда можно запускать (мс): повтор после провала или отложенный старт; null — готово */
	retryAt: number | null
	/** последняя активность идущего задания, мс (старт, `read`, `draft`, вызов агента): сторожевой таймер */
	activityAt?: number | null
	/** строгий протокол чтения сборщика (`collect`/`close`): принятые блоки, выданный блок, отказы; задаётся обработчиком при старте */
	protocol?: ProtocolState | null
	/** параметры задания (у `match` — `caseIds`, у любого — `after`: кейсы, которых надо дождаться) */
	payload: Record<string, unknown> | null
}

/** Блок, выданный `case read`, но ещё без принятого описания. */
export interface PendingBlock {
	from: number
	until: number
	/** текст блока: по нему проверяется описание */
	text: string
}

/** Шаги сборщика: чтение блок за блоком, следующий блок — только после принятого описания. */
export interface ProtocolState {
	/** `coveredUntil` на старте задания */
	base: number
	/** событий к обработке на старте задания */
	total: number
	/** до какого `n` описание принято (старт — `base`) */
	ackedUntil: number
	/** принятых событий в этом задании */
	acknowledged: number
	/** принятых блоков в этом задании */
	blocks: number
	pending: PendingBlock | null
	/** отказы по текущему блоку */
	rejects: number
	/** отказов набралось на провал: агент снимается, задание повторяется свежим агентом */
	exhausted: boolean
	/** принята итоговая консолидация (`--final`) */
	finalAccepted: boolean
}

/** Что протокол чтения берёт у сервиса обучения. */
export interface ProtocolHost {
	getCase(id: string): CaseState
	collecting(id: string): JobState | undefined
	readRaw(id: string, from: number, to?: number): RawEvent[]
	readSummary(id: string): string
	writeSummary(id: string, text: string): boolean
	writeDraft(id: string, text: string): boolean
	update(c: CaseState): void
	changed(job: JobState): void
	touch(caseId: string): void
	cancelAgent(agentId: string): void
	now(): number
}

/** Плейбук на диске: видимая часть и служебное состояние обучения. */
export interface PlaybookState extends PlaybookView {
	/** вердикты судьи по кейсам: id кейса → вердикты по правилам */
	verdicts: Record<string, RuleVerdict[]>
	/** отклонённые правки улучшателя (отпечатки), чтобы не предлагать снова */
	rejectedEdits: string[]
	/** сколько раз ревью возвращало плейбук на доработку */
	reviewAttempts: number
}

export interface LearningHost {
	/** все сессии, кроме служебных */
	sessions(): SessionView[]
	/** лента после seq; окно памяти — иначе с диска */
	messagesSince(seq: number): Message[]
	/** текущий `seq` ленты */
	lastSeq(): number
	/** m.session ?? сессия агента to/from */
	sessionOfMessage(m: Message): string | null
	/** есть работающий агент или очередь */
	isBusy(sessionIds: readonly string[]): boolean
	/** агент удаляется после ответа; текст ответа сервис сохраняет сам (`writeRun`) */
	runAgent(req: { name: string; title: string; prompt: string; onSpawn?: (agentId: string) => void }): Promise<{ agentId: string; text: string; ok: boolean; error?: string }>
	/** прервать ход агента (остановка сборщика); агента уже нет — не ошибка */
	cancelAgent(agentId: string): Promise<void>
}

export interface LearningDeps {
	store: LearningStorePort
	host: LearningHost
	hub: Hub
	clock: Clock
	ids: IdGenerator
	defaultOn: boolean
	tickMs: number
	claudeProjectsDir: string
	/** хранилище плейбуков; без него сервис работает как на этапе 1 (нет обработчиков плейбуков, `playbooks = []`) */
	playbookStore?: PlaybookStorePort
	/** версия плагина nessy-playbooks при публикации; по умолчанию `1.0.<счётчик публикаций>` */
	pluginVersion?: () => string
}

/** Параметры постановки задания (`JobQueue.enqueue`). */
export interface EnqueueOpts {
	/** кейс задания; у заданий не над кейсом — не задан (`''`) */
	caseId?: string
	final?: boolean
	payload?: Record<string, unknown> | null
	/** пауза до первого запуска, мс (повтор без горячего цикла) */
	delayMs?: number
	/** как свести `payload` уже ждущего задания с новым */
	merge?: (a: Record<string, unknown> | null, b: Record<string, unknown> | null) => Record<string, unknown> | null
}

export interface PlaybookServiceDeps {
	store: PlaybookStorePort
	hub: Hub
	clock: Clock
	ids: IdGenerator
	/** версия плагина nessy-playbooks при публикации; по умолчанию `1.0.<счётчик публикаций>` */
	pluginVersion?: () => string
	/** кейс по id (нужен только `playbook` кейса) */
	caseOf?: (id: string) => { playbook: string | null } | null
}

/** Запись журнала до выдачи `id` и времени. */
export type NewEntry = Omit<JournalEntry, 'id' | 'ts'>
