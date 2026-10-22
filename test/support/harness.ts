/**
 * Стенд интеграционных тестов: настоящее приложение (buildApp) + фейковый nessy serve,
 * свой каталог состояния, свой порт API и свой диапазон портов serve.
 * close() обязательно вызывать в after(): останавливает HTTP, агентов и процессы serve.
 */
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildApp } from '../../src/app'
import type { AppInstance } from '../../src/app.types'
import type { Config } from '../../src/infrastructure/config/config.types'
import { request, SseClient } from './http-client'
import { drainReads } from './read-blocks'
import { repoRoot } from './repo-root'
import type { Harness, HarnessOptions } from './support.types'

const ROOT = repoRoot()
const FAKE = path.join(__dirname, 'fake-nessy.js')
const CLI = path.join(ROOT, 'bin', 'nessy-orch')
let counter = 0

function freeApiPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const s = net.createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const addr = s.address()
			const port = typeof addr === 'object' && addr ? addr.port : 0
			s.close(() => resolve(port))
		})
	})
}

/** Диапазон портов serve, разный для параллельных процессов тестов и для стендов в одном процессе. */
function serveBasePort(): number {
	counter++
	return 21000 + ((process.pid * 53 + counter * 211) % 24000)
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
	// при нестандартном outDir (не dist/) postbuild exec-бит не ставил: без него serve не запускается и сборщики висят
	fs.chmodSync(FAKE, 0o755)
	const base = opts.base ?? fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-test-'))
	const home = path.join(base, 'home')
	const ws = path.join(base, 'ws')
	fs.mkdirSync(ws, { recursive: true })

	let app: AppInstance | null = null
	let port = 0
	for (let attempt = 0; attempt < 5 && !app; attempt++) {
		port = await freeApiPort()
		const config: Config = {
			root: ROOT,
			host: '127.0.0.1',
			port,
			home,
			nessyBin: FAKE,
			nessyServeArgs: [],
			serveBasePort: serveBasePort(),
			maxSessionsPerSpace: 20,
			autoApprove: true,
			maxHops: 8,
			rateLimitPerMinute: 30,
			healthTimeoutMs: 10000,
			cliPath: CLI,
			seedRoles: false,
			learningDefaultOn: false,
			learningTickMs: 0,
			rolesDir: path.join(base, 'roles'),
			playbooksPluginDir: path.join(base, 'plugin', 'nessy-playbooks'),
			...opts.config,
		}
		const candidate = buildApp(config, 'test')
		try {
			await candidate.listen()
			app = candidate
		} catch {
			await candidate.close() // порт успели занять — пробуем другой
		}
	}
	if (!app) throw new Error('не удалось поднять API на свободном порту')
	app.start()
	// агент фейкового serve выполняет `#relay` через настоящий CLI, направленный на этот стенд
	process.env['FAKE_NESSY_CLI'] = `ORCH_PORT=${port} NO_COLOR=1 ${process.execPath} ${CLI}`
	process.env['FAKE_NESSY_DELAY_MS'] ??= '10'

	const started = app
	// фейковый агент-сборщик читать сессию не умеет: за него блоки событий читает стенд (как `nessy-orch case read`)
	const reader = setInterval(() => {
		if (opts.autoRead === false) return
		try {
			drainReads(started.orch.learning ?? null)
		} catch {
			// кейс или задание исчезли между проверкой и чтением
		}
	}, 3)
	reader.unref()
	let closed = false
	return {
		app: started,
		orch: started.orch,
		port,
		base,
		home,
		ws,
		api: (method, p, body, headers) => request(port, method, p, body, headers),
		sse: p => SseClient.open(port, p),
		close: async ({ keepFiles = false } = {}) => {
			if (closed) return
			closed = true
			clearInterval(reader)
			await started.close()
			if (!keepFiles) fs.rmSync(base, { recursive: true, force: true })
		},
	}
}
