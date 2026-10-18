import type { JobKind, LearningSettings } from '../../../shared/types'
import type { RawEvent } from '../../domain/learning.types'
import type { CaseState, EnqueueOpts, JobState, PlaybookState } from './learning.types'
import type { PlaybookService } from './playbook.service'

/** Параметры постановки задания из обработчика (то же, что у очереди). */
export type JobEnqueueOpts = EnqueueOpts

/** Что обработчик задания видит и может: агенты, кейсы, плейбуки, очередь. */
export interface JobContext {
	job: JobState
	now(): number
	settings(): LearningSettings
	/** ok:false и прерывание остановкой — исключение; текст ответа сохраняется в `runs/` */
	runAgent(name: string, title: string, prompt: string): Promise<{ agentId: string; text: string }>
	prompt(name: string): string
	cases: {
		get(id: string): CaseState | null
		all(): CaseState[]
		summary(id: string): string
		notes(id: string): string
		raw(id: string, from: number, to?: number): RawEvent[]
		update(c: CaseState): void
		/** false — не записалось */
		writeSummary(id: string, text: string): boolean
		/** заметки пользователя кейса целиком */
		writeNotes(id: string, text: string): void
		/** итоговое описание готово: кейс `ready` (пустой удаляется), ставит последующие задания */
		seal(id: string): void
	}
	/** без хранилища плейбуков — null (обработчики плейбуков тогда не регистрируются) */
	playbooks: PlaybookService | null
	/** очередь подсказок плейбука (хук UserPromptSubmit); нет — сборщик подсказок не ставит */
	hints?: HintHost
	/** ответ агента в чат объекта (кейса `c-…` или плейбука `p-…`); `changes` — изменённые файлы */
	chat(subject: string, text: string, changes: string[]): void
	enqueue(kind: JobKind, subject: string, opts?: JobEnqueueOpts): void
	/** задание выполнено: `done`, необязательная пометка; повторный вызов не нужен — сервис завершает задание сам */
	finish(note?: string): void
	/** опубликовать изменение задания (например, `range`) */
	changed(): void
}

/** Исполнитель заданий одного или нескольких видов; исключение = провал задания (повторы этапа 1). */
export interface JobHandler {
	kinds: readonly JobKind[]
	run(ctx: JobContext): Promise<void>
}

/** Что `onCaseReady` берёт у сервиса. */
export interface CaseReadyHost {
	cases: { get(id: string): CaseState | null }
	enqueue(kind: JobKind, subject: string, opts?: JobEnqueueOpts): void
	/** пачка бэкфилла кейса (все её кейсы) или null; пачка выдаётся один раз */
	batch(caseId: string): string[] | null
}

/** Что подсказка плейбука берёт у сервиса обучения (`hintFor`, сборщик); `hinted` переживает рестарт. */
export interface HintHost {
	/** все плейбуки (подсказываются только `trial`/`active`) */
	playbooks(): PlaybookState[]
	/** кейс цепочки сессии или null */
	caseOf(session: string): CaseState | null
	/** запомнить подсказку: в `CaseState.hinted` кейса сессии (нет кейса — хотя бы до рестарта) */
	markHinted(session: string, playbookId: string): void
	/** подсказанное сессии без кейса (в памяти); с кейсом читается из `CaseState.hinted` */
	hintedOf?(session: string): string[]
	/** подсказка от сборщика: отдаст ближайший `hint` сессии кейса, даже если текст запроса не совпал */
	queueHint(caseId: string, playbookId: string): void
	/** вынуть очередную подсказку сессии (один раз) или null */
	takeQueued(session: string): string | null
}
