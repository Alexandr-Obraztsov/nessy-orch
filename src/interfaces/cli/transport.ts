/**
 * Транспорт CLI к оркестратору. Интерфейс вынесен отдельно, чтобы команды можно было
 * юнит-тестировать на моке (без живого HTTP/демона). Реальный транспорт оборачивает
 * существующий HTTP/SSE-клиент `../cli/client`.
 */
import type { Endpoint } from './client.types'
import { endpoint, request, setAgentKey as clientSetAgentKey, sse as realSse } from './client'

export interface SseHandle {
	done: Promise<void>
	close: () => void
}

/** Инъектируемый слой ввода-вывода команд. */
export interface Transport {
	get<T>(path: string): Promise<T>
	post<T>(path: string, body?: unknown): Promise<T>
	put<T>(path: string, body?: unknown): Promise<T>
	patch<T>(path: string, body?: unknown): Promise<T>
	del(path: string): Promise<unknown>
	/** ключ агента (`--key`): добавляется в заголовок X-Agent-Key для команд от его имени (`--from`) */
	setAgentKey(key?: string): void
	/** подписка на SSE; `onData` вызывается на каждый разобранный кадр (unknown → guard в команде) */
	sse(path: string, onData: (raw: unknown) => void): SseHandle
}

/** Транспорт поверх существующего HTTP/SSE-клиента CLI (реальный демон). */
export class HttpTransport implements Transport {
	private readonly ep: Endpoint
	constructor(env: NodeJS.ProcessEnv = process.env) {
		this.ep = endpoint(env)
	}

	setAgentKey(key?: string): void {
		clientSetAgentKey(key)
	}

	get<T>(path: string): Promise<T> {
		return request(this.ep, 'GET', path) as Promise<T>
	}

	post<T>(path: string, body?: unknown): Promise<T> {
		return request(this.ep, 'POST', path, body) as Promise<T>
	}

	put<T>(path: string, body?: unknown): Promise<T> {
		return request(this.ep, 'PUT', path, body) as Promise<T>
	}

	patch<T>(path: string, body?: unknown): Promise<T> {
		return request(this.ep, 'PATCH', path, body) as Promise<T>
	}

	del(path: string): Promise<unknown> {
		return request(this.ep, 'DELETE', path)
	}

	sse(path: string, onData: (raw: unknown) => void): SseHandle {
		return realSse(this.ep, path, onData)
	}
}

/** Реальный транспорт (используется main; в тестах подменяется моком). */
export function makeTransport(env: NodeJS.ProcessEnv = process.env): Transport {
	return new HttpTransport(env)
}
