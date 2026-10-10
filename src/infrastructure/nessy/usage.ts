/**
 * Токены из ответов nessy. Точная форма `usage` в turn_complete и ответа GET /session/:id/stats не зафиксирована
 * в контракте (docs/contract), поэтому ищем по именам полей: inputTokens / input_tokens / promptTokens,
 * outputTokens / completionTokens, cachedReadTokens / cachedTokens, totalTokens — на глубине до 4 уровней.
 */
import type { TokenUsage } from '../../../shared/types'
import { isObject } from '../../lib/json'

const FIELDS: Record<keyof TokenUsage, readonly string[]> = {
	input: ['inputtokens', 'prompttokens', 'input', 'prompt'],
	output: ['outputtokens', 'completiontokens', 'output', 'completion'],
	cached: ['cachedreadtokens', 'cachereadtokens', 'cachedtokens', 'cachedinputtokens', 'cached', 'cacheread'],
	total: ['totaltokens', 'total'],
}

const norm = (k: string): string => k.toLowerCase().replace(/[_\-\s]/g, '')

function pick(o: Record<string, unknown>, names: readonly string[]): number {
	for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && names.includes(norm(k))) return Math.round(v)
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
