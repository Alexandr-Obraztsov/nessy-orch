/** Потоковый разбор SSE (text/event-stream): куски байтов → готовые кадры. */
import type { SseFrame } from '../types'

export class SseParser {
	private buf = ''
	private data: string[] = []
	private event = ''
	private id: string | null = null
	private readonly decoder = new TextDecoder('utf-8')

	/** Скормить очередной кусок; вернуть кадры, которые он завершил. */
	feed(chunk: Uint8Array | string): SseFrame[] {
		this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
		const out: SseFrame[] = []
		for (;;) {
			const m = /\r\n|\r|\n/.exec(this.buf)
			if (!m) break
			// одиночный \r в конце буфера может оказаться началом \r\n — ждём следующий кусок
			if (m[0] === '\r' && m.index === this.buf.length - 1) break
			const line = this.buf.slice(0, m.index)
			this.buf = this.buf.slice(m.index + m[0].length)
			const frame = this.line(line)
			if (frame) out.push(frame)
		}
		return out
	}

	/** Сбросить состояние (новое соединение). */
	reset(): void {
		this.buf = ''
		this.data = []
		this.event = ''
		this.id = null
	}

	private line(line: string): SseFrame | null {
		if (line === '') return this.dispatch()
		if (line.startsWith(':')) return null // комментарий / heartbeat
		const colon = line.indexOf(':')
		const field = colon < 0 ? line : line.slice(0, colon)
		let value = colon < 0 ? '' : line.slice(colon + 1)
		if (value.startsWith(' ')) value = value.slice(1)
		if (field === 'data') this.data.push(value)
		else if (field === 'event') this.event = value
		else if (field === 'id' && !value.includes('\0')) this.id = value
		return null
	}

	private dispatch(): SseFrame | null {
		if (this.data.length === 0) {
			this.event = ''
			return null
		}
		const frame: SseFrame = { event: this.event || 'message', data: this.data.join('\n'), id: this.id }
		this.data = []
		this.event = ''
		return frame
	}
}
