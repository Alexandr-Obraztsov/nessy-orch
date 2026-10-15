/**
 * Токены из ответов nessy. Точная форма `usage` в turn_complete и ответа GET /session/:id/stats не зафиксирована
 * в контракте (docs/contract), поэтому ищем по именам полей: inputTokens / input_tokens / promptTokens,
 * outputTokens / completionTokens, cachedReadTokens / cachedTokens, totalTokens — на глубине до 4 уровней.
 */
import type { TokenUsage } from '../../../shared/types'
import { isObject } from '../../lib/json'

const FIELDS: Record<keyof TokenUsage, readonly string[]> = {
	input: ['inputtokens', 'prompttokens', 'input', 'prompt', 'tokensin', 'intokens', 'inputtokencount', 'promptcount'],
	output: ['outputtokens', 'completiontokens', 'output', 'completion', 'tokensout', 'outtokens', 'outputtokencount', 'generatedtokens'],
	cached: ['cachedreadtokens', 'cachereadtokens', 'cachedtokens', 'cachedinputtokens', 'cached', 'cacheread', 'cachereadinputtokens'],
	total: ['totaltokens', 'total', 'tokens'],
}

const norm = (k: string): string => k.toLowerCase().replace(/[_\-\s]/g, '')

function pick(o: Record<string, unknown>, names: readonly string[]): number {
	for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && names.includes(norm(k))) return Math.round(v)
	return 0
}

function pickFloat(o: Record<string, unknown>, names: readonly string[]): number {
	for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v) && v > 0 && names.includes(norm(k))) return v
	return 0
}

/** Первый (самый поверхностный) объект с ненулевыми input/output; null — токенов в ответе нет. */
export function extractUsage(root: unknown, depth = 0): TokenUsage | null {
	if (!isObject(root) || depth > 4) return null
	const input = pick(root, FIELDS.input)
	const output = pick(root, FIELDS.output)
	if (input > 0 || output > 0) {
		const cached = pick(root, FIELDS.cached)
		const total = pick(root, FIELDS.total) || input + output
		return { input, output, cached, total }
	}
	for (const v of Object.values(root)) {
		const hit = extractUsage(v, depth + 1)
		if (hit) return hit
	}
	return null
}

const USED = ['used', 'usedtokens', 'currenttokens', 'contexttokens', 'tokens', 'totaltokens']
const PCT = ['percent', 'percentage', 'usedpercent', 'usedpercentage', 'usagepercent', 'pct', 'ratio']
const SIZE = ['size', 'contextwindow', 'maxtokens', 'limit', 'windowsize', 'contextsize']

/** Заполнение контекста из ответа context-usage: used/size под любыми из привычных имён, на глубине до 3 уровней. */
export function extractContext(root: unknown, depth = 0): { used: number; size: number | null } | null {
	if (!isObject(root) || depth > 3) return null
	const used = pick(root, USED)
	if (used > 0) return { used, size: pick(root, SIZE) || null }
	// только доля: приводим к «из 100»
	const pct = pickFloat(root, PCT)
	if (pct > 0) return { used: Math.round(pct <= 1 ? pct * 100 : pct), size: 100 }
	for (const v of Object.values(root)) {
		const hit = extractContext(v, depth + 1)
		if (hit) return hit
	}
	return null
}
