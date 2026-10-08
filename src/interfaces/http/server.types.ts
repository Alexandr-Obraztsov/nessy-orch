import type * as http from 'node:http'
import type { Orchestrator } from '../../application/orchestrator'

export interface ServerOptions {
	version: string
	uiDir: string
	port: number
	host: string
}

/** Контекст обработки одного запроса. */
export interface RouteContext {
	req: http.IncomingMessage
	res: http.ServerResponse
	orch: Orchestrator
	opts: ServerOptions
	/** параметры пути (`:ref`, `:name`, …), уже декодированные */
	params: Record<string, string>
	query: URLSearchParams
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>

export interface Route {
	method: string
	segments: string[]
	handler: RouteHandler
}
