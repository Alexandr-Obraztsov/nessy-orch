/** NessyClient: создание сессий по одной и повтор при таймауте nessy. */
import assert from 'node:assert/strict'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import { NessyClient } from '../../../src/infrastructure/nessy/nessy-client'

interface Fake {
	url: string
	maxParallel: number
	calls: number
	close: () => Promise<void>
}

/** Фейковый serve: POST /session отвечает через delayMs; первые failFirst запросов — 500 «newSession timeout». */
async function fakeServe(delayMs: number, failFirst = 0): Promise<Fake> {
	let active = 0
	const st = { maxParallel: 0, calls: 0 }
	const server = http.createServer((req, res) => {
		req.resume()
		req.on('end', () => {
			const n = ++st.calls
			active++
			st.maxParallel = Math.max(st.maxParallel, active)
			setTimeout(() => {
				active--
				if (n <= failFirst) {
					res.writeHead(500, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ error: 'AcpSessionBridge newSession timeout' }))
					return
				}
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ sessionId: `s-${n}` }))
			}, delayMs)
		})
	})
	await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
	const port = (server.address() as AddressInfo).port
	return {
		url: `http://127.0.0.1:${port}`,
		get maxParallel() {
			return st.maxParallel
		},
		get calls() {
			return st.calls
		},
		close: () => new Promise<void>(r => server.close(() => r())),
	}
}

describe('NessyClient: сессии', () => {
	const fakes: Fake[] = []
	after(async () => {
		for (const f of fakes) await f.close()
	})

	it('параллельные createSession уходят в nessy по одному', async () => {
		const f = await fakeServe(30)
		fakes.push(f)
		const c = new NessyClient(f.url)
		const ids = await Promise.all([1, 2, 3, 4].map(() => c.createSession('/tmp')))
		assert.equal(new Set(ids.map(x => x.sessionId)).size, 4)
		assert.equal(f.maxParallel, 1)
	})

	it('таймаут newSession внутри nessy (5xx) — один повтор', { timeout: 10000 }, async () => {
		const f = await fakeServe(5, 1)
		fakes.push(f)
		const c = new NessyClient(f.url)
		const r = await c.createSession('/tmp')
		assert.equal(r.sessionId, 's-2')
		assert.equal(f.calls, 2)
	})
})
