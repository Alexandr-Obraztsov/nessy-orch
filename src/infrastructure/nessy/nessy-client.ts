/**
 * NessyClient — HTTP/SSE-клиент одного `nessy serve` (реализация порта NessyGateway).
 * Вместе с event-mapper.ts — единственное место, которое знает протокол nessy.
 * Контракт и статус проверки эндпоинтов — docs/contract/README.md.
 *
 * Права подтверждаем голосованием (POST /session/:id/permission/:requestId):
 * POST /session/:id/approval-mode требует токена, которого у оркестратора нет.
 */
import * as http from 'node:http'
import { URL } from 'node:url'
import type { NessyGateway, SessionSubscription, SubscribeOptions } from '../../application/ports'
import { AppError } from '../../domain/errors'
import { isObject, parseJson, str, strOrNull } from '../../lib/json'
import type { JsonObject } from '../../lib/json.types'
import { clip } from '../../lib/text'
import { SseParser } from '../sse/sse-parser'
import { NessyEventMapper } from './event-mapper'
import type { NessyResponse } from './protocol.types'

const RECONNECT_MS = 1000

export class NessyClient implements NessyGateway {
	private readonly host: string
	private readonly port: number

	/** @param token NESSY_SERVER_TOKEN — передаётся как `Authorization: Bearer` (иначе serve с токеном отвечает 401) */
	constructor(
		readonly baseUrl: string,
		private readonly token: string | null = null,
	) {
		const u = new URL(baseUrl)
		this.host = u.hostname
		this.port = parseInt(u.port, 10) || 80
	}

	private auth(): Record<string, string> {
		return this.token ? { Authorization: `Bearer ${this.token}` } : {}
	}

	// ---------- низкий уровень ----------
	request(method: string, path: string, body?: unknown, timeoutMs = 30000): Promise<NessyResponse> {
		return new Promise((resolve, reject) => {
			const payload = body === undefined ? null : JSON.stringify(body)
			const req = http.request(
				{
					host: this.host,
					port: this.port,
					method,
					path,
					headers: {
						Accept: 'application/json',
						...this.auth(),
						...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
					},
				},
				res => {
					let d = ''
					res.setEncoding('utf8')
					res.on('data', (c: string) => (d += c))
					res.on('end', () => {
						const parsed = parseJson(d)
						resolve({ status: res.statusCode ?? 0, json: isObject(parsed) ? parsed : { raw: d } })
					})
				},
			)
			req.setTimeout(timeoutMs, () => req.destroy(new Error(`таймаут ${method} ${path}`)))
			req.on('error', reject)
			if (payload) req.write(payload)
			req.end()
		})
	}

	private async ok(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<JsonObject> {
		const r = await this.request(method, path, body, timeoutMs)
		if (r.status >= 400) {
			const detail = str(r.json['error']) || str(r.json['raw']) || JSON.stringify(r.json)
			throw new AppError(502, 'nessy_error', `nessy ${method} ${path} → ${r.status}: ${clip(detail, 300)}`)
		}
		return r.json
	}

	// ---------- высокий уровень ----------
	async health(): Promise<boolean> {
		try {
			const r = await this.request('GET', '/health', undefined, 3000)
			return r.status === 200
		} catch {
			return false
		}
	}

	/** Создать независимую сессию (один субагент = одна сессия). */
	async createSession(cwd: string): Promise<{ sessionId: string }> {
		const j = await this.ok('POST', '/session', { cwd, sessionScope: 'thread' }, 60000)
		const sessionId = strOrNull(j['sessionId'])
		if (!sessionId) throw new AppError(502, 'nessy_error', 'nessy не вернул sessionId: ' + clip(JSON.stringify(j)))
		return { sessionId }
	}

	async resumeSession(sessionId: string, cwd: string): Promise<boolean> {
		try {
			const r = await this.request('POST', `/session/${sessionId}/load`, { cwd })
			return r.status < 300
		} catch {
			return false
		}
	}

	/** Отправить промпт (асинхронно: результат придёт событиями). */
	async prompt(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		const j = await this.ok('POST', `/session/${sessionId}/prompt`, { prompt: [{ type: 'text', text }] })
		return { promptId: strOrNull(j['promptId']) }
	}

	async cancel(sessionId: string): Promise<void> {
		await this.request('POST', `/session/${sessionId}/cancel`, {}).catch(() => undefined)
	}

	async closeSession(sessionId: string): Promise<void> {
		await this.request('DELETE', `/session/${sessionId}`).catch(() => undefined)
	}

	async vote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		const body = optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }
		await this.request('POST', `/session/${sessionId}/permission/${requestId}`, body)
	}

	/** Подписка на SSE-поток сессии с автопереподключением и Last-Event-ID. */
	subscribe(sessionId: string, opts: SubscribeOptions): SessionSubscription {
		let closed = false
		let req: http.ClientRequest | null = null
		let lastId = opts.lastEventId
		let retry: NodeJS.Timeout | null = null
		const mapper = new NessyEventMapper()

		const again = (): void => {
			if (closed || retry) return
			opts.onState?.('reconnecting')
			retry = setTimeout(() => {
				retry = null
				connect()
			}, RECONNECT_MS)
		}

		const connect = (): void => {
			if (closed) return
			const headers: Record<string, string> = { Accept: 'text/event-stream', ...this.auth() }
			if (lastId !== null) headers['Last-Event-ID'] = String(lastId)
			req = http.request({ host: this.host, port: this.port, method: 'GET', path: `/session/${sessionId}/events`, headers }, res => {
				if (res.statusCode !== 200) {
					res.resume()
					if (res.statusCode === 404) {
						closed = true
						opts.onEvent({ kind: 'died', reason: 'сессия не найдена в nessy' }, lastId)
						return
					}
					again()
					return
				}
				opts.onState?.('open')
				res.setEncoding('utf8')
				const parser = new SseParser(f => {
					if (closed) return
					if (f.id !== null && /^\d+$/.test(f.id)) lastId = parseInt(f.id, 10)
					const ev = mapper.map(f.event, parseJson(f.data))
					if (ev) opts.onEvent(ev, lastId)
				})
				res.on('data', (c: string) => parser.push(c))
				res.on('end', again)
				res.on('error', again)
			})
			req.on('error', again)
			req.end()
		}

		connect()
		return {
			close(): void {
				closed = true
				if (retry) clearTimeout(retry)
				retry = null
				req?.destroy()
			},
		}
	}
}
