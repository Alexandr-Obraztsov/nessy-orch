/**
 * ServeSpace — пространство: путь + (опционально) управляемый процесс `nessy serve`.
 *   managed  — оркестратор сам запускает `nessy serve` на свободном порту;
 *   external — `url` указывает на уже запущенный демон.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import type { SpaceStatus, SpaceView } from '../../../shared/types'
import type { NessyGateway, SpaceInit, SpaceListener, SpaceRuntime } from '../../application/ports'
import { PALETTE } from '../../domain/constants'
import { sleep } from '../../lib/async'
import { errMsg } from '../../lib/json'
import { freePort } from './free-port'
import type { ServeSpaceDeps } from './serve-space.types'

const KILL_GRACE_MS = 5000
const STOP_WAIT_MS = 6000
const HEALTH_POLL_MS = 300

export class ServeSpace implements SpaceRuntime {
	readonly name: string
	readonly path: string
	readonly url: string | null
	readonly color: number
	status: SpaceStatus = 'stopped'
	error: string | null = null
	client: NessyGateway | null = null

	private port: number | null = null
	private proc: ChildProcess | null = null
	private tail: string[] = []
	private starting: Promise<void> | null = null
	private stopping = false

	constructor(
		init: SpaceInit,
		private readonly deps: ServeSpaceDeps,
		private readonly listener: SpaceListener,
	) {
		this.name = init.name
		this.path = init.path
		this.url = init.url ?? null
		this.color = init.color ?? PALETTE[0] ?? 210
	}

	get managed(): boolean {
		return !this.url
	}

	toJSON(): SpaceView {
		return {
			name: this.name,
			path: this.path,
			color: this.color,
			mode: this.managed ? 'managed' : 'external',
			url: this.url ?? (this.port ? `http://127.0.0.1:${this.port}` : null),
			status: this.status,
			error: this.error,
		}
	}

	private setStatus(status: SpaceStatus, error: string | null = null): void {
		this.status = status
		this.error = error
		this.listener.onStatus(this)
	}

	async ensureReady(): Promise<NessyGateway> {
		if (this.status === 'ready' && this.client) return this.client
		this.starting ??= this.start().finally(() => {
			this.starting = null
		})
		await this.starting
		if (!this.client) throw new Error(`пространство «${this.name}» недоступно`)
		return this.client
	}

	private async start(): Promise<void> {
		this.stopping = false
		this.setStatus('starting')
		const { settings } = this.deps
		try {
			let client: NessyGateway
			if (this.url) {
				client = this.deps.makeClient(this.url)
			} else {
				const port = await freePort(settings.serveBasePort, this.deps.usedPorts)
				this.deps.usedPorts.add(port)
				this.port = port
				client = this.deps.makeClient(`http://127.0.0.1:${port}`)
				this.spawnServe(port)
			}
			this.client = client
			const t0 = Date.now()
			while (Date.now() - t0 < settings.healthTimeoutMs) {
				if (this.isStopping()) throw new Error('пространство остановлено во время запуска')
				if (await client.health()) {
					this.setStatus('ready')
					return
				}
				if (this.managed && !this.proc) throw new Error('nessy serve завершился при запуске: ' + this.tail.slice(-3).join(' | '))
				await sleep(HEALTH_POLL_MS)
			}
			throw new Error('nessy serve не ответил на /health за отведённое время')
		} catch (e) {
			this.setStatus('failed', errMsg(e))
			this.client = null
			this.kill()
			throw e
		}
	}

	/** Флаг меняется асинхронно (stop() во время запуска) — читаем через метод, без сужения типа. */
	private isStopping(): boolean {
		return this.stopping
	}

	private spawnServe(port: number): void {
		const { settings } = this.deps
		const args = [
			'serve',
			'--port',
			String(port),
			'--hostname',
			'127.0.0.1',
			'--no-web',
			'--workspace',
			this.path,
			'--max-sessions',
			String(settings.maxSessionsPerSpace),
			...settings.nessyServeArgs,
		]
		const log = fs.createWriteStream(this.deps.logPath(this.name), { flags: 'a' })
		log.on('error', () => undefined) // каталог логов мог исчезнуть — не роняем процесс
		log.write(`\n--- ${new Date().toISOString()} spawn ${settings.nessyBin} ${args.join(' ')}\n`)
		const proc = spawn(settings.nessyBin, args, { cwd: this.path, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
		this.deps.processes?.track(proc, { port, workspace: this.path })
		const onData = (d: Buffer | string): void => {
			log.write(d)
			for (const l of String(d).split('\n')) if (l.trim()) this.tail.push(l.trim())
			if (this.tail.length > 30) this.tail.splice(0, this.tail.length - 30)
		}
		proc.stdout.on('data', onData)
		proc.stderr.on('data', onData)
		proc.on('error', e => onData(`spawn error: ${e.message}`))
		proc.on('exit', (code, signal) => {
			log.end(`--- exit code=${code} signal=${signal}\n`)
			if (this.proc === proc) this.proc = null
			this.deps.usedPorts.delete(port)
			const wasReady = this.status === 'ready'
			const intended = this.stopping
			this.client = null
			if (intended) this.setStatus('stopped')
			else if (wasReady) this.setStatus('failed', `nessy serve завершился (code=${code}, signal=${signal})`)
			this.listener.onExit(this, { intended, code, signal })
		})
		this.proc = proc
	}

	private kill(): void {
		const p = this.proc
		if (!p) return
		this.stopping = true
		try {
			p.kill('SIGTERM')
		} catch {
			/* нет прав на сигнал — процесс сам выйдет, заметив смену родителя */
		}
		setTimeout(() => {
			if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL')
		}, KILL_GRACE_MS).unref()
	}

	async stop(): Promise<void> {
		this.stopping = true
		const p = this.proc
		if (p && p.exitCode === null && p.signalCode === null) {
			let timer: NodeJS.Timeout | undefined
			const done = new Promise<void>(r => p.once('exit', () => r()))
			this.kill()
			await Promise.race([done, new Promise<void>(r => (timer = setTimeout(r, STOP_WAIT_MS)))])
			clearTimeout(timer)
		}
		this.client = null
		this.setStatus('stopped')
	}
}
