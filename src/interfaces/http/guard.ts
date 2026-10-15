/**
 * Защита от DNS-rebinding и CSRF из браузера: агенты работают с автоподтверждением,
 * поэтому любая страница в браузере не должна уметь дёргать API.
 */
import * as crypto from 'node:crypto'
import type * as http from 'node:http'
import { AppError } from '../../domain/errors'
import type { Caller } from './server.types'

export function assertLocalClient(req: http.IncomingMessage, port: number): void {
	const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
	const host = (req.headers.host ?? '').toLowerCase()
	if (!allowedHosts.includes(host)) throw new AppError(403, 'bad_host', 'недопустимый Host')
	const origin = req.headers.origin
	if (origin !== undefined) {
		const o = origin.toLowerCase()
		if (o !== `http://127.0.0.1:${port}` && o !== `http://localhost:${port}`) throw new AppError(403, 'bad_origin', 'недопустимый Origin')
	}
}

const eq = (a: string, b: string): boolean => {
	const x = crypto.createHash('sha256').update(a).digest()
	const y = crypto.createHash('sha256').update(b).digest()
	return crypto.timingSafeEqual(x, y)
}

/** Кто вызывает: оператор — с верным токеном в `X-Orch-Token` (токен не задан — все); агентский ключ — из `X-Agent-Key`. */
export function identify(req: http.IncomingMessage, token: string | undefined): Caller {
	const header = (name: string): string | null => {
		const v = req.headers[name]
		return typeof v === 'string' && v ? v : null
	}
	const given = header('x-orch-token')
	return { operator: !token || (given !== null && eq(given, token)), agentKey: header('x-agent-key') }
}

/** Маршруты, которые агент может вызвать от своего имени (остальное меняющее — только оператору). */
const AGENT_ROUTES = new Set(['POST /agents', 'POST /agents/:ref/send', 'POST /agents/:ref/plan', 'DELETE /agents/:ref/plan'])

export function assertAllowed(method: string, pattern: string, caller: Caller): void {
	if (caller.operator || method === 'GET' || AGENT_ROUTES.has(pattern)) return
	throw new AppError(403, 'operator_required', 'эта команда доступна только оператору (главному агенту и приложению): в твоём окружении нет токена')
}
