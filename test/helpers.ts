import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createServer } from '../src/api/server'
import type { Config } from '../src/core/config'
import { Orchestrator } from '../src/core/orchestrator'

export interface Harness {
	orch: Orchestrator
	server: http.Server
	port: number
	home: string
	ws: string
	api: <T = unknown>(
		method: string,
		path: string,
		body?: unknown,
	) => Promise<{ status: number; body: T }>
	close: () => Promise<void>
}

export async function startHarness(
	overrides: Partial<Config> = {},
): Promise<Harness> {
	const base = fs.mkdtempSync(
		path.join(process.env['TMPDIR'] ?? os.tmpdir(), 'nessy-orch-test-'),
	)
	const home = path.join(base, 'home')
	const ws = path.join(base, 'ws')
	fs.mkdirSync(ws, { recursive: true })
	const root = path.resolve(__dirname, '..', '..')
	const fake = path.join(root, 'dist', 'test', 'fake-nessy.js')
	const config: Config = {
		root,
		host: '127.0.0.1',
		port: 0,
		home,
		nessyBin: fake,
		nessyServeArgs: [],
		serveBasePort: 4700 + Math.floor(Math.random() * 1000),
		maxSessionsPerSpace: 20,
		autoApprove: true,
		maxHops: 8,
		rateLimitPerMinute: 30,
		healthTimeoutMs: 15000,
		uiDir: path.join(root, 'dist', 'ui'),
		cliPath: path.join(root, 'bin', 'nessy-orch'),
		...overrides,
	}
	const orch = new Orchestrator(config)
	orch.load()
	// порт выбираем после listen(0), а Host-проверка сервера зависит от порта — поэтому два шага
	const probe = http.createServer()
	await new Promise<void>(r => probe.listen(0, '127.0.0.1', r))
	const port = (probe.address() as AddressInfo).port
	await new Promise<void>(r => probe.close(() => r()))
	config.port = port
	const server = createServer(orch, {
		version: 'test',
		uiDir: config.uiDir,
		port,
		host: '127.0.0.1',
	})
	await new Promise<void>(r => server.listen(port, '127.0.0.1', r))

	const api = <T = unknown>(
		method: string,
		p: string,
		body?: unknown,
	): Promise<{ status: number; body: T }> =>
		new Promise((resolve, reject) => {
			const payload = body === undefined ? null : JSON.stringify(body)
			const req = http.request(
				{
					host: '127.0.0.1',
					port,
					method,
					path: p,
					headers: payload
						? {
								'Content-Type': 'application/json',
								'Content-Length': Buffer.byteLength(payload),
							}
						: {},
				},
				res => {
					let d = ''
					res.on('data', (c: Buffer) => (d += c.toString()))
					res.on('end', () =>
						resolve({
							status: res.statusCode ?? 0,
							body: (d ? JSON.parse(d) : {}) as T,
						}),
					)
				},
			)
			req.on('error', reject)
			if (payload) req.write(payload)
			req.end()
		})

	return {
		orch,
		server,
		port,
		home,
		ws,
		api,
		close: async () => {
			server.closeAllConnections()
			await new Promise<void>(r => server.close(() => r()))
			await orch.shutdown()
			fs.rmSync(base, { recursive: true, force: true })
		},
	}
}

export async function until(
	cond: () => boolean,
	ms = 8000,
	what = 'условие',
): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`таймаут ожидания: ${what}`)
		await new Promise(r => setTimeout(r, 25))
	}
}
