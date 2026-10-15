/**
 * Токены и контекст из ответов `nessy serve` (формат снят с живого демона, а не угадан):
 *  - GET /session/:id/stats → `models.<модель>.tokens.{prompt, candidates, total, cached}`; сумма по всем моделям сессии
 *    (в сессии могут работать несколько моделей: основная и вспомогательная);
 *  - GET /session/:id/context-usage → `usage.totalTokens` (занято в окне) и `usage.contextWindowSize` (окно модели).
 * Других форм оркестратор не ждёт: нет нужных полей — значит данных нет (null), а не догадка и не значение по умолчанию.
 */
import type { TokenUsage } from '../../../shared/types'
import { isObject } from '../../lib/json'

const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)

export function parseStats(root: unknown): TokenUsage | null {
	if (!isObject(root) || !isObject(root['models'])) return null
	const sum: TokenUsage = { input: 0, output: 0, cached: 0, total: 0 }
	for (const m of Object.values(root['models'])) {
		if (!isObject(m) || !isObject(m['tokens'])) continue
		const t = m['tokens']
		sum.input += nat(t['prompt'])
		sum.output += nat(t['candidates'])
		sum.cached += nat(t['cached'])
		sum.total += nat(t['total']) || nat(t['prompt']) + nat(t['candidates'])
	}
	return sum.total > 0 ? sum : null
}

export function parseContextUsage(root: unknown): { used: number; size: number } | null {
	if (!isObject(root) || !isObject(root['usage'])) return null
	const used = nat(root['usage']['totalTokens'])
	const size = nat(root['usage']['contextWindowSize'])
	return used > 0 && size > 0 ? { used, size } : null
}
