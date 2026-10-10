/**
 * Ошибка предметной области с кодом и HTTP-подобным статусом.
 * Интерфейсный слой (HTTP) переводит её в ответ `{error, code}` с этим статусом.
 */
export class AppError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message?: string,
	) {
		super(message ?? code)
	}
}

/** Причина отказа nessy, которую имеет смысл переждать и повторить. */
export type NessyBusyReason = 'queue_full' | 'rate_limited' | 'session_busy' | 'unavailable'

/** Временный отказ nessy serve (очередь промптов переполнена, лимит запросов, сессия занята): повтор возможен. */
export class NessyBusyError extends AppError {
	constructor(
		public readonly reason: NessyBusyReason,
		message: string,
		/** сколько просит подождать nessy (Retry-After), мс */
		public readonly retryAfterMs: number | null = null,
	) {
		super(503, 'nessy_busy', message)
	}
}
