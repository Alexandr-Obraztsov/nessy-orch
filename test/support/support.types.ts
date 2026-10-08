/** Типы тестового стенда. */
import type { AppInstance } from '../../src/app.types'
import type { Orchestrator } from '../../src/application/orchestrator'
import type { Config } from '../../src/infrastructure/config/config.types'
import type { SseClient } from './http-client'

export interface ApiResult<T> {
	status: number
	body: T
}

export interface Harness {
	app: AppInstance
	orch: Orchestrator
	port: number
	/** каталог стенда (home + ws) */
	base: string
	home: string
	ws: string
	api: <T = unknown>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<ApiResult<T>>
	sse: (path: string) => Promise<SseClient>
	/** остановить; keepFiles — не удалять каталог (для проверки рестарта) */
	close: (opts?: { keepFiles?: boolean }) => Promise<void>
}

export interface HarnessOptions {
	config?: Partial<Config>
	/** переиспользовать каталог предыдущего стенда (рестарт) */
	base?: string
	/** вызвать app.start() после listen (по умолчанию да) */
	start?: boolean
}
