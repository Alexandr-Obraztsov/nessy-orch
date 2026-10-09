/** Экспоненциальная пауза переподключения с небольшим разбросом (чтобы не биться в такт). */

export interface BackoffOptions {
	baseMs: number
	maxMs: number
	factor: number
	/** доля разброса 0..1: итог умножается на случайное из [1 - jitter, 1] */
	jitter: number
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 15000, factor: 2, jitter: 0.2 }

/** Пауза перед попыткой номер `attempt` (0 — первая повторная). */
export function backoffDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
	const n = Math.max(0, Math.floor(attempt))
	const raw = Math.min(opts.maxMs, opts.baseMs * Math.pow(opts.factor, n))
	const k = 1 - opts.jitter * Math.min(1, Math.max(0, random()))
	return Math.round(raw * k)
}
