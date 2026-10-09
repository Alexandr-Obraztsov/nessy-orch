/**
 * Оркестратор внутри приложения. Приложение — один процесс: собранный сервер nessy-orch
 * (`<root>/dist/src/app.js`) поднимается прямо в main-процессе Electron на 127.0.0.1:4337.
 * Если порт уже занят нашим оркестратором (запущен из терминала или launchd) — подключаемся к нему,
 * если чужим процессом — состояние error с понятным текстом.
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import type { HostState, ProbeResult } from '../types'

/** То, что нужно от AppInstance сервера (src/app.types.ts). */
export interface EmbeddedServer {
	listen(): Promise<void>
	start(): void
	close(): Promise<void>
	killChildrenSync(): void
}

/** То, что нужно от Config сервера; остальные поля передаются обратно в buildApp как есть. */
export interface ServerConfig {
	root: string
	host: string
	port: number
	uiDir: string
}

export interface ServerModules {
	loadConfig(env: NodeJS.ProcessEnv): ServerConfig
	buildApp(config: ServerConfig, version: string): EmbeddedServer
}

const isFn = (o: Record<string, unknown>, k: string): boolean => typeof o[k] === 'function'
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Загрузить собранный сервер (CommonJS) из каталога nessy-orch с проверкой формы экспорта. */
export function loadServerModules(root: string): ServerModules {
	const appJs = path.join(root, 'dist', 'src', 'app.js')
	const configJs = path.join(root, 'dist', 'src', 'infrastructure', 'config', 'load-config.js')
	if (!fs.existsSync(appJs) || !fs.existsSync(configJs)) throw new Error(`сервер не собран: нет ${appJs}. Выполните npm run build в ${root}`)
	const load = createRequire(path.join(root, 'package.json'))
	const app: unknown = load(appJs)
	const cfg: unknown = load(configJs)
	if (!isObj(app) || !isFn(app, 'buildApp') || !isObj(cfg) || !isFn(cfg, 'loadConfig')) throw new Error(`неожиданный формат ${appJs}: нет buildApp / loadConfig`)
	// форма экспорта проверена выше; типы совпадают с src/app.ts и load-config.ts
	const buildApp = app['buildApp'] as (config: ServerConfig, version: string) => unknown
	const loadConfig = cfg['loadConfig'] as (env: NodeJS.ProcessEnv) => unknown
	return {
		loadConfig: env => {
			const c = loadConfig(env)
			if (!isObj(c) || typeof c['port'] !== 'number' || typeof c['host'] !== 'string' || typeof c['root'] !== 'string' || typeof c['uiDir'] !== 'string')
				throw new Error('loadConfig вернул неожиданный объект')
			return c as unknown as ServerConfig
		},
		buildApp: (config, version) => {
			const a = buildApp(config, version)
			if (!isObj(a) || !['listen', 'start', 'close', 'killChildrenSync'].every(k => isFn(a, k))) throw new Error('buildApp вернул неожиданный объект')
			return a as unknown as EmbeddedServer
		},
	}
}

/** Версия из package.json корня сервера. */
export function serverVersion(root: string): string {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
		if (isObj(raw) && typeof raw['version'] === 'string') return raw['version']
	} catch {
		/* нет package.json — не критично */
	}
	return '0.0.0'
}

export interface ServerHostDeps {
	root: string
	env: NodeJS.ProcessEnv
	load(root: string): ServerModules
	probe(statusUrl: string): Promise<ProbeResult>
	onState(state: HostState): void
	log(msg: string): void
}

const errCode = (e: unknown): string | undefined => (e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined)
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export class ServerHost {
	private server: EmbeddedServer | null = null
	private current: HostState = { kind: 'starting' }
	private pending: Promise<HostState> | null = null
	private url = 'http://127.0.0.1:4337'

	constructor(private readonly deps: ServerHostDeps) {}

	get state(): HostState {
		return this.current
	}

	/** Адрес оркестратора (известен после первой загрузки конфигурации). */
	get baseUrl(): string {
		return this.url
	}

	get embedded(): boolean {
		return this.server !== null
	}

	/** Поднять сервер или подключиться к работающему. Параллельные вызовы ждут одну попытку. */
	ensure(): Promise<HostState> {
		this.pending ??= this.run().finally(() => {
			this.pending = null
		})
		return this.pending
	}

	/** Перезапустить встроенный сервер (агенты переподключатся к сохранённым сессиям). */
	async restart(): Promise<HostState> {
		await this.stop()
		return this.ensure()
	}

	/** Остановить встроенный сервер: закрыть HTTP, остановить nessy serve, записать состояние. */
	async stop(): Promise<void> {
		const s = this.server
		this.server = null
		if (!s) return
		try {
			await s.close()
		} catch (e) {
			this.deps.log('ошибка остановки: ' + errMsg(e))
		} finally {
			s.killChildrenSync()
		}
	}

	/** На выходе процесса: синхронно погасить дочерние nessy serve. */
	killSync(): void {
		this.server?.killChildrenSync()
	}

	private set(state: HostState): HostState {
		this.current = state
		this.deps.onState(state)
		return state
	}

	private async run(): Promise<HostState> {
		if (this.server) return this.current
		this.set({ kind: 'starting' })
		let mods: ServerModules
		let config: ServerConfig
		try {
			mods = this.deps.load(this.deps.root)
			config = mods.loadConfig(this.deps.env)
		} catch (e) {
			return this.set({ kind: 'error', title: 'Оркестратор не найден', detail: errMsg(e) })
		}
		this.url = `http://127.0.0.1:${config.port}`
		for (let attempt = 0; attempt < 2; attempt++) {
			const probe = await this.deps.probe(this.url + '/status')
			if (probe.kind === 'ours') return this.set({ kind: 'attached', url: this.url, version: probe.version, pid: probe.pid })
			if (probe.kind === 'foreign')
				return this.set({ kind: 'error', title: `Порт ${config.port} занят другим приложением`, detail: `${probe.detail}. Освободите порт или задайте ORCH_PORT в ~/.zshrc.` })
			const server = mods.buildApp(config, serverVersion(config.root))
			try {
				await server.listen()
			} catch (e) {
				server.killChildrenSync()
				// порт заняли между пробой и listen — проверим ещё раз, кто это
				if (errCode(e) === 'EADDRINUSE' && attempt === 0) continue
				return this.set({ kind: 'error', title: 'Оркестратор не запустился', detail: errMsg(e) })
			}
			server.start()
			this.server = server
			this.deps.log(`оркестратор запущен в приложении: ${this.url} (root=${config.root})`)
			return this.set({ kind: 'embedded', url: this.url })
		}
		return this.set({ kind: 'error', title: `Порт ${config.port} занят`, detail: 'Не удалось ни занять порт, ни подключиться к оркестратору на нём.' })
	}
}
