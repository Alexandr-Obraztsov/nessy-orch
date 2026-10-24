/**
 * Стенд интеграционных тестов: настоящее приложение (buildApp) + фейковый AgentPort,
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
import { FakeAgentPort } from './fake-agent-port'
import { FakeSpace } from './memory-store'
import { request, SseClient } from './http-client'
import { drainReads } from './read-blocks'
import { repoRoot } from './repo-root'
import type { Harness, HarnessOptions } from './support.types'

const ROOT = repoRoot()
const CLI = path.join(ROOT, 'bin', 'nessy-orch')

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

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
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
			runtime: 'nessy-sdk',
			autoApprove: true,
			maxHops: 8,
			rateLimitPerMinute: 30,
			cliPath: CLI,
			seedRoles: false,
			learningDefaultOn: false,
			rolesDir: path.join(base, 'roles'),
			playbooksPluginDir: path.join(base, 'plugin', 'nessy-playbooks'),
			...opts.config,
		}
		// пространства ядра в интеграционных тестах держат FakeAgentPort (serve-путь удалён): HTTP/CLI-поверхность настоящая,
		// рантайм агента — детерминированный in-process фейк (если не передан свой spaceFactory)
		const candidate = buildApp(config, 'test', {
			spaceFactory: opts.spaceFactory ?? ((init, listener) => new FakeSpace(init.name, init.path, new FakeAgentPort(), listener)),
		})
		try {
			await candidate.listen()
			app = candidate
		} catch {
			await candidate.close() // порт успели занять — пробуем другой
		}
	}
	if (!app) throw new Error('не удалось поднять API на свободном порту')
	app.start()
	// #relay агента выполняет настоящий CLI, направленный на этот стенд
	process.env['FAKE_NESSY_CLI'] = `ORCH_PORT=${port} NO_COLOR=1 ${process.execPath} ${CLI}`

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
