import { AppError } from './errors'

const WINDOW_MS = 60_000

/** Лимит сообщений в минуту на пару «отправитель → адресат» (скользящее окно). */
export class RateLimiter {
	private readonly hits = new Map<string, number[]>()

	constructor(
		private readonly perMinute: number,
		private readonly now: () => number = Date.now,
	) {}

	/** Учесть сообщение; при превышении лимита — AppError 429. */
	check(from: string, to: string): void {
		const key = `${from}>${to}`
		const t = this.now()
		const list = (this.hits.get(key) ?? []).filter(x => t - x < WINDOW_MS)
		if (list.length >= this.perMinute)
			throw new AppError(429, 'rate_limit', `слишком много сообщений ${from} → ${to} (лимит ${this.perMinute}/мин)`)
		list.push(t)
		this.hits.set(key, list)
	}
}
