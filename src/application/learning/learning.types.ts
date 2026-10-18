import type { CaseView, JobView, Message, SessionView } from '../../../shared/types'
import type { Clock, IdGenerator, LearningStorePort } from '../ports'
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
}

export type JobState = JobView & { final: boolean; retryAt: number | null }

export interface LearningHost {
	/** все сессии, кроме служебных */
	sessions(): SessionView[]
	/** лента после seq; окно памяти — иначе с диска */
	messagesSince(seq: number): Message[]
	/** m.session ?? сессия агента to/from */
	sessionOfMessage(m: Message): string | null
	/** есть работающий агент или очередь */
	isBusy(sessionIds: readonly string[]): boolean
	runAgent(req: { name: string; title: string; prompt: string }): Promise<{ agentId: string; text: string; ok: boolean; error?: string }>
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
}
