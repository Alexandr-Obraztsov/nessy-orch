/**
 * Имитация агента-сборщика в тестах: по строгому протоколу читает блок, сдаёт валидное описание с якорями
 * (`case draft`) и после `done` — итоговую консолидацию (`--final`).
 */
import type { CaseReadBlock, RawEvent } from '../../shared/types'
import type { LearningService } from '../../src/application/learning/learning.service'
import { blockFacts, correctionEvents } from '../../src/domain/summary-gate'
import { eventText } from '../../src/domain/case-events'

/** Короткая цитата из события (до `words` слов) без кавычек и переводов строк. */
const quote = (e: RawEvent, words = 8): string =>
	eventText(e)
		.replace(/["\n]+/g, ' ')
		.trim()
		.split(/\s+/)
		.slice(0, words)
		.join(' ')

/**
 * Валидное по всем правилам описание событий `1..until`: по пункту на событие (якорь `n k`), идентификаторы блока одной строкой,
 * поправки пользователя цитатами; `tag` попадает в первую строку цели, чтобы текст отличался от прежнего.
 */
export function summaryFor(events: readonly RawEvent[], block: { from: number; until: number }, title = 'T'): string {
	const inBlock = events.filter(e => e.n >= block.from && e.n <= block.until)
	const facts = blockFacts(inBlock)
	const corrections = correctionEvents(inBlock)
	return [
		`# ${title}`,
		'## Goal: do the task (type: do task)',
		'### Plan',
		'- work through the events step by step',
		'### Actions',
		...events.map(e => `- ${e.kind} step ${quote(e, 3)} — agent — done (n ${e.n})`),
		...(facts.length ? [`- identifiers: ${facts.join(', ')} (n ${block.from}–${block.until})`] : []),
		'### User corrections',
		...(corrections.length ? corrections.map(e => `- User: "${quote(e, 10)}" (n ${e.n})`) : ['- none']),
		'### Sources',
		'- none',
		'### Skipped',
		'- none',
		'### Open questions',
		'- none',
	].join('\n')
}

/** Описание с корректным блоком `## Brief` в конце (итоговая консолидация, `--final`); прежний Brief заменяется. */
export function withBrief(summary: string): string {
	const body = summary.replace(/\n## Brief[\s\S]*$/, '').trimEnd()
	return [
		body,
		'## Brief',
		'gist: the user asked for a task; the agent did it and the result was accepted.',
		'entities: PROJ-1, src/app/main.ts',
		'skeleton:',
		'1. plan',
		'2. execute',
		'3. verify',
	].join('\n')
}

/** Агент читает следующий блок и сдаёт валидное описание; возвращает блок. */
export function submitBlock(svc: LearningService, caseId: string): CaseReadBlock {
	const b = svc.caseRead(caseId)
	if (!b.done) svc.caseDraft(caseId, summaryFor(svc.caseRaw(caseId, 1, b.until), b), false)
	return b
}

/** Читает блоки идущих заданий `collect`/`close` до `done` и сдаёт описания, затем `--final`. */
export function drainReads(svc: LearningService | null): void {
	if (!svc) return
	for (const j of svc.view().jobs) {
		if (j.status !== 'running' || (j.kind !== 'collect' && j.kind !== 'close')) continue
		for (;;) {
			const b = svc.caseRead(j.caseId)
			if (b.done) {
				// консолидация: принятое описание без потерь
				svc.caseDraft(j.caseId, withBrief(svc.getCaseDetail(j.caseId).summary), true)
				break
			}
			svc.caseDraft(j.caseId, summaryFor(svc.caseRaw(j.caseId, 1, b.until), b), false)
		}
	}
}
