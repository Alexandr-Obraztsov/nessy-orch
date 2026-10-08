/** HTTP- и SSE-клиент для интеграционных тестов. */
import * as http from 'node:http'
import { SseParser } from '../../src/infrastructure/sse/sse-parser'
import { until } from './wait'

export interface ApiResult<T> {
	status: number
	body: T
}

export function request<T = unknown>(
	port: number,
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body)
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				method,
				path,
				agent: false,
				headers: {
					...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
					...headers,
				},
			},
			res => {
				let d = ''
				res.setEncoding('utf8')
				res.on('data', (c: string) => (d += c))
				res.on('end', () => {
					let parsed: unknown = {}
					try {
						parsed = d ? JSON.parse(d) : {}
					} catch {
						parsed = { raw: d }
					}
					resolve({ status: res.statusCode ?? 0, body: parsed as T })
				})
			},
		)
		req.setTimeout(30000, () => req.destroy(new Error(`таймаут ${method} ${path}`)))
		req.on('error', reject)
		if (payload) req.write(payload)
		req.end()
	})
}

/** Подписка на SSE: копит разобранные data-кадры. */
export class SseClient {
	readonly events: unknown[] = []
	private req: http.ClientRequest | null = null
	status = 0

	private constructor() {}

	static open(port: number, path: string): Promise<SseClient> {
		const c = new SseClient()
		return new Promise((resolve, reject) => {
			c.req = http.request({ host: '127.0.0.1', port, path, agent: false, headers: { Accept: 'text/event-stream' } }, res => {
				c.status = res.statusCode ?? 0
				res.setEncoding('utf8')
				const parser = new SseParser(f => {
					try {
						c.events.push(JSON.parse(f.data))
					} catch {
						/* не JSON — пропускаем */
					}
				})
				res.on('data', (d: string) => parser.push(d))
				res.on('error', () => undefined)
				resolve(c)
			})
			c.req.on('error', e => {
				if (!c.status) reject(e)
			})
			c.req.end()
		})
	}

	/** Дождаться события, удовлетворяющего предикату; вернуть его. */
	async waitFor<T>(pred: (e: unknown) => e is T, ms = 8000, what = 'событие SSE'): Promise<T> {
		await until(() => this.events.some(pred), ms, what)
		return this.events.find(pred) as T
	}

	close(): void {
		this.req?.destroy()
		this.req = null
	}
}
