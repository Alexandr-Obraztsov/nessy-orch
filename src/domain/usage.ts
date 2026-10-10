import type { TokenUsage } from '../../shared/types'

/** Сумма токенов; null — «нет данных» (одна из сторон может быть null). */
export const addUsage = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null =>
	a && b ? { input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached, total: a.total + b.total } : (a ?? b)
