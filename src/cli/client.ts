/** HTTP/SSE-клиент CLI к оркестратору. */
import * as http from 'node:http'
import type { AgentStreamEvent, ApiError, StreamEvent } from '../../shared/types'
import { SseParser } from '../core/sse'
import { isObject, parseJson, str } from '../core/json'

export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message)
	}
}

export interface Endpoint {
	host: string
	port: number
}

export function endpoint(env: NodeJS.ProcessEnv = process.env): Endpoint {
	const port = parseInt(env['ORCH_PORT'] ?? '', 10)
	return { host: '127.0.0.1', port: Number.isFinite(port) ? port : 4337 }
}

const UNREACHABLE =
	'оркестратор недоступен. Запустите его (вне песочницы): `launchctl kickstart -k gui/$(id -u)/com.nessy.orch` или `node ~/Projects/nessy-orch/dist/src/main.js`'

export function request(ep: Endpoint, method: string, path: string, body?: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body)
		const req = http.request(
			{
				host: ep.host,
				port: ep.port,
				method,
				path,
				headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
			},
			res => {
				let d = ''
				res.setEncoding('utf8')
				res.on('data', (c: string) => (d += c))
				res.on('end', () => {
					const json = d ? parseJson(d) : {}
					if ((res.statusCode ?? 0) >= 400) {
						const e: Partial<ApiError> = isObject(json) ? { error: str(json['error']), code: str(json['code']) } : {}
						reject(new CliError(`${e.error || d || 'ошибка'}${e.code ? ` [${e.code}]` : ''}`))
						return
					}
					resolve(json)
				})
			},
		)
		req.on('error', () => reject(new CliError(UNREACHABLE)))
		if (payload) req.write(payload)
		req.end()
	})
}

/** Подписка на SSE. Возвращает функцию остановки; промис завершается при разрыве соединения. */
export function sse(
	ep: Endpoint,
	path: string,
	onData: (data: unknown) => void,
): { done: Promise<void>; close: () => void } {
	let req: http.ClientRequest | null = null
	const done = new Promise<void>((resolve, reject) => {
		req = http.request({ host: ep.host, port: ep.port, method: 'GET', path, headers: { Accept: 'text/event-stream' } }, res => {
			if (res.statusCode !== 200) {
				let d = ''
				res.on('data', (c: Buffer) => (d += c.toString()))
				res.on('end', () => {
					const j = parseJson(d)
					reject(new CliError(isObject(j) ? str(j['error'], d) : d))
				})
				return
			}
			res.setEncoding('utf8')
			const parser = new SseParser(f => {
				const v = parseJson(f.data)
				if (v !== undefined) onData(v)
			})
			res.on('data', (c: string) => parser.push(c))
			res.on('end', () => resolve())
			res.on('error', () => resolve())
		})
		req.on('error', () => reject(new CliError(UNREACHABLE)))
		req.end()
	})
	return { done, close: () => req?.destroy() }
}

// Узкие type guards для кадров потоков (данные приходят как unknown).
export const asStreamEvent = (v: unknown): StreamEvent | null => (isObject(v) && typeof v['t'] === 'string' ? (v as unknown as StreamEvent) : null)
export const asAgentStreamEvent = (v: unknown): AgentStreamEvent | null => (isObject(v) && typeof v['t'] === 'string' ? (v as unknown as AgentStreamEvent) : null)
