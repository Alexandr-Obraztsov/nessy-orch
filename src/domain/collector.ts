import type { CaseGoal } from '../../shared/types'
import type { CollectorInput, CollectorResult } from './learning.types'

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
	}
	return template.replace(/\{\{(case_id|session_title|summary|notes|total|mode)\}\}/g, (_m, key: string) => values[key] ?? '')
}

function lastBlock(text: string, tag: string): string | null {
	const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
	let found: string | null = null
	for (const m of text.matchAll(re)) found = m[1] ?? ''
	return found
}

function parseMeta(raw: string | null): { goals: CaseGoal[] } {
	const empty = { goals: [] }
	if (raw === null) return empty
	let data: unknown
	try {
		data = JSON.parse(raw.trim())
	} catch {
		return empty
	}
	if (typeof data !== 'object' || data === null) return empty
	const obj = data as Record<string, unknown>
	const goals: CaseGoal[] = []
	if (Array.isArray(obj.goals)) {
		for (const g of obj.goals) {
			if (typeof g !== 'object' || g === null) continue
			const goal = g as Record<string, unknown>
			if (typeof goal.title !== 'string' || goal.title.trim() === '') continue
			goals.push({ title: goal.title.trim(), type: typeof goal.type === 'string' ? goal.type.trim() : '' })
		}
	}
	return { goals }
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

/** Разбирает ответ сборщика; нет непустого `<summary>` — null. */
export function parseCollectorReply(text: string): CollectorResult | null {
	const summary = lastBlock(text, 'summary')?.trim() ?? ''
	if (summary === '') return null
	return { summary, ...parseMeta(lastBlock(text, 'meta')) }
}
