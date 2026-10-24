import type { CaseGoal } from '../../shared/types'
import { DEFAULT_LEARNING, MAX_REJECTS } from './learning-settings'
import type { CollectorInput } from './learning.types'

const EMPTY_SUMMARY = '(empty — start a new summary)'
const MODE_FINAL = 'final: finish every section, the session has ended'
const MODE_INCREMENTAL = 'incremental: update only what the new events change'

/** Подставляет вход в шаблон за один проход: данные не разбираются повторно как плейсхолдеры. */
export function buildCollectorPrompt(template: string, input: CollectorInput): string {
	const values: Record<string, string> = {
		case_id: input.caseId,
		session_title: input.sessionTitle.replace(/\s+/g, ' ').trim(),
		summary: input.summary.trim() === '' ? EMPTY_SUMMARY : input.summary,
		notes: input.notes.trim() === '' ? '(none)' : input.notes,
		total: String(input.total),
		mode: input.final ? MODE_FINAL : MODE_INCREMENTAL,
		block_events: String(input.blockEvents ?? DEFAULT_LEARNING.blockEvents),
		max_attempts: String(MAX_REJECTS),
	}
	return template.replace(/\{\{(case_id|session_title|summary|notes|total|mode|block_events|max_attempts)\}\}/g, (_m, key: string) => values[key] ?? '')
}

/** Цели (`## Goal: … (type: …)`) описания, записанного руками; название кейса — название сессии, из текста не берётся. */
export function parseSummaryHeads(text: string): { goals: CaseGoal[] } {
	const goals: CaseGoal[] = []
	for (const line of text.split('\n')) {
		const g = /^##\s+Goal:\s*(.*?)\s*$/.exec(line)
		if (!g) continue
		const m = /^(.*?)\s*\(type:\s*([^)]*)\)\s*$/.exec(g[1] ?? '')
		const goalTitle = (m ? m[1] : g[1]) ?? ''
		if (goalTitle.trim() !== '') goals.push({ title: goalTitle.trim(), type: (m?.[2] ?? '').trim() })
	}
	return { goals }
}
