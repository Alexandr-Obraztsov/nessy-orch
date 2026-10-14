import type * as http from 'node:http'
import type { Orchestrator } from '../../application/orchestrator'

export interface ServerOptions {
	version: string
	port: number
	host: string
	/** токен оператора; нет — все вызывающие считаются оператором */
	token?: string
}

/** Кто вызывает: оператор (по токену) или агент (ключ из его вводной — проверяется на маршрутах «от имени агента»). */
export interface Caller {
	operator: boolean
	agentKey: string | null
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
	caller: Caller
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>

export interface Route {
	method: string
	segments: string[]
	handler: RouteHandler
}

export interface RouteMatch {
	pattern: string
	handler: RouteHandler
	params: Record<string, string>
}
