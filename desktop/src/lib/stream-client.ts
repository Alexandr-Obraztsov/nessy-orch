/**
 * Подписка на общий поток `/stream` из main-процесса: node:http + разбор SSE,
 * переподключение с экспоненциальной паузой, сброс паузы после снапшота.
 */
import * as http from 'node:http'
import type { StreamEvent } from '../../../shared/types'
import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from './backoff'
import { parseStreamEvent } from './notify-policy'
import { SseParser } from './sse'

export interface StreamHandlers {
	onEvent(evt: StreamEvent): void
	/** соединение установлено (HTTP 200) */
	onOpen?(): void
	/** соединение потеряно; delayMs — через сколько следующая попытка */
	onClose?(delayMs: number): void
}

export interface StreamOptions {
	backoff: BackoffOptions
	/** нет ни байта дольше этого (сервер шлёт heartbeat раз в 15 с) — соединение мёртвое */
	idleTimeoutMs: number
}

export class StreamClient {
	private req: http.ClientRequest | null = null
	private timer: NodeJS.Timeout | null = null
	private idle: NodeJS.Timeout | null = null
	private attempt = 0
	private running = false
	private readonly opts: StreamOptions

	constructor(
		private readonly url: string,
		private readonly handlers: StreamHandlers,
		opts: Partial<StreamOptions> = {},
	) {
		this.opts = { backoff: DEFAULT_BACKOFF, idleTimeoutMs: 45000, ...opts }
	}

	start(): void {
		if (this.running) return
		this.running = true
		this.connect()
	}

	stop(): void {
		this.running = false
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		this.clearIdle()
		this.req?.destroy()
		this.req = null
	}

	/** Переподключиться сейчас же (например, оркестратор только что поднялся). */
	reconnectNow(): void {
		if (!this.running) return
		this.attempt = 0
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
			this.connect()
		}
	}

	private connect(): void {
		this.timer = null
		const parser = new SseParser()
		let closed = false
		const close = (): void => {
			if (closed) return
			closed = true
			this.clearIdle()
			this.req = null
			this.scheduleRetry()
		}
		const req = http.get(this.url, { headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' } }, res => {
			if (res.statusCode !== 200) {
				res.resume()
				req.destroy()
				close()
				return
			}
			this.handlers.onOpen?.()
			this.touch(req)
			res.on('data', (chunk: Buffer) => {
				this.touch(req)
				for (const frame of parser.feed(chunk)) {
					const evt = parseStreamEvent(frame.data)
					if (!evt) continue
					if (evt.t === 'snapshot') this.attempt = 0
					this.handlers.onEvent(evt)
				}
			})
			res.on('end', close)
			res.on('error', close)
			res.on('close', close)
		})
		req.on('error', close)
		this.req = req
	}

	private scheduleRetry(): void {
		if (!this.running) return
		const delay = backoffDelay(this.attempt++, this.opts.backoff)
		this.handlers.onClose?.(delay)
		if (!this.running || this.timer) return
		this.timer = setTimeout(() => this.connect(), delay)
	}

	private touch(req: http.ClientRequest): void {
		this.clearIdle()
		this.idle = setTimeout(() => req.destroy(), this.opts.idleTimeoutMs)
	}

	private clearIdle(): void {
		if (this.idle) clearTimeout(this.idle)
		this.idle = null
	}
}
