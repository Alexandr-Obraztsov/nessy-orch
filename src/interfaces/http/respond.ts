/** Чтение тела запроса и отправка JSON-ответов. */
import type * as http from 'node:http'
import { AppError } from '../../domain/errors'
import { parseJson } from '../../lib/json'

const MAX_BODY = 5 * 1024 * 1024

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	const s = JSON.stringify(body)
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(s),
		'Cache-Control': 'no-store',
	})
	res.end(s)
}

export function readBody(req: http.IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let size = 0
		const chunks: Buffer[] = []
		req.on('data', (c: Buffer) => {
			size += c.length
			if (size > MAX_BODY) {
				reject(new AppError(413, 'too_large', 'тело запроса слишком большое'))
				req.destroy()
				return
			}
			chunks.push(c)
		})
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8')
			if (!raw) {
				resolve({})
				return
			}
			const v = parseJson(raw)
			if (v === undefined) reject(new AppError(400, 'bad_json', 'тело запроса — не JSON'))
			else resolve(v)
		})
		req.on('error', reject)
	})
}

/** Число из query-параметра (или значение по умолчанию). */
export function queryNum(v: string | null, d: number): number {
	const n = Number(v)
	return v !== null && Number.isFinite(n) ? n : d
}
