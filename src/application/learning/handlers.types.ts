import type { JobKind, LearningSettings } from '../../../shared/types'
import type { RawEvent } from '../../domain/learning.types'
import type { CaseState, EnqueueOpts, JobState } from './learning.types'
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
		/** итоговое описание готово: кейс `ready` (пустой удаляется), ставит последующие задания */
		seal(id: string): void
	}
	/** без хранилища плейбуков — null (обработчики плейбуков тогда не регистрируются) */
	playbooks: PlaybookService | null
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
