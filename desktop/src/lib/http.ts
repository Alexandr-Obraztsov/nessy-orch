/** Маленькие HTTP-помощники на node:http (main-процесс ходит в API без fetch и CORS). */
import * as http from 'node:http'
import type { ProbeRaw } from '../types'

const errCode = (e: unknown): string => (e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : 'EUNKNOWN')

/** GET с таймаутом; ошибка соединения — в errorCode, без исключений. */
export function getRaw(url: string, timeoutMs = 1500): Promise<ProbeRaw> {
	return new Promise(resolve => {
		const req = http.get(url, { timeout: timeoutMs, headers: { Accept: 'application/json' } }, res => {
			const chunks: Buffer[] = []
			let size = 0
			res.on('data', (c: Buffer) => {
				size += c.length
				if (size <= 64 * 1024) chunks.push(c)
			})
			res.on('end', () => resolve({ errorCode: null, statusCode: res.statusCode ?? null, body: Buffer.concat(chunks).toString('utf8') }))
			res.on('error', e => resolve({ errorCode: errCode(e), statusCode: null, body: '' }))
		})
		req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
		req.on('error', e => resolve({ errorCode: errCode(e), statusCode: null, body: '' }))
	})
}

/** POST JSON; результат — код ответа (0 — сеть недоступна). */
export function postJson(url: string, body: unknown, timeoutMs = 5000): Promise<number> {
	return new Promise(resolve => {
		const data = JSON.stringify(body)
		const req = http.request(
			url,
			{ method: 'POST', timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
			res => {
				res.resume()
				res.on('end', () => resolve(res.statusCode ?? 0))
			},
		)
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', () => resolve(0))
		req.end(data)
	})
}
