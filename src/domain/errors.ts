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
