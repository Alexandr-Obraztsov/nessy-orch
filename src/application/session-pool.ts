/**
 * Пул заранее созданных сессий nessy. Создание сессии (поднятие контекста, MCP-серверов) — самое долгое при запуске агента;
 * пул создаёт их про запас и держит по `target` на пространство, так что `spawn` берёт готовую сессию и агент стартует сразу.
 * Сессии в nessy эфемерны (в памяти serve): при падении serve пул пространства сбрасывается, а залежавшиеся (старше TTL)
 * заменяются свежими.
 */
import type { SpaceRuntime } from './ports'

interface Entry {
	id: string
	at: number
}

export interface PoolDeps {
	/** сколько сессий держать на пространство (0 — пул выключен) */
	target: () => number
	getSpace: (name: string) => SpaceRuntime | undefined
	now: () => number
	isShuttingDown: () => boolean
	/** время жизни заготовки, мс (по умолчанию 10 минут) */
	ttlMs?: number
}

const DEFAULT_TTL_MS = 10 * 60 * 1000
/** пауза после неудачи создания, чтобы не долбить упавший serve */
const RETRY_AFTER_MS = 5000

export class SessionPool {
	private readonly ready = new Map<string, Entry[]>()
	private readonly filling = new Map<string, Promise<void>>()
	private readonly failedAt = new Map<string, number>()

	constructor(private readonly deps: PoolDeps) {}

	/** Взять готовую свежую сессию (или null) и запустить пополнение. */
	take(space: string): string | null {
		const list = this.ready.get(space) ?? []
		const ttl = this.deps.ttlMs ?? DEFAULT_TTL_MS
		let hit: string | null = null
		while (list.length) {
			const e = list.shift() as Entry
			if (this.deps.now() - e.at <= ttl) {
				hit = e.id
				break
			}
			this.discard(space, e.id) // залежалась — nessy мог её закрыть
		}
		this.warm(space)
		return hit
	}

	/** Поднять serve пространства и наполнить пул до target (в фоне, ошибки не пробрасываются). */
	warm(space: string): void {
		if (this.deps.target() <= 0 || this.deps.isShuttingDown() || this.filling.has(space)) return
		const failed = this.failedAt.get(space)
		if (failed !== undefined && this.deps.now() - failed < RETRY_AFTER_MS) return
		const run = this.fill(space).finally(() => this.filling.delete(space))
		this.filling.set(space, run)
	}

	private async fill(space: string): Promise<void> {
		const rt = this.deps.getSpace(space)
		if (!rt) return
		try {
			const client = await rt.ensureReady()
			for (;;) {
				const list = this.ready.get(space) ?? []
				if (list.length >= this.deps.target() || this.deps.isShuttingDown() || !this.deps.getSpace(space)) return
				const { sessionId } = await client.sessionCreate(rt.path)
				if (this.deps.isShuttingDown() || !this.deps.getSpace(space)) {
					void client.sessionClose(sessionId).catch(() => undefined)
					return
				}
				const now = this.ready.get(space) ?? []
				now.push({ id: sessionId, at: this.deps.now() })
				this.ready.set(space, now)
				this.failedAt.delete(space)
			}
		} catch {
			this.failedAt.set(space, this.deps.now())
		}
	}

	/** Пространство упало или удалено: заготовки больше недействительны. */
	clear(space: string, close = false): void {
		const list = this.ready.get(space) ?? []
		this.ready.delete(space)
		if (close) for (const e of list) this.discard(space, e.id)
	}

	/** Закрыть все заготовки (остановка оркестратора; нужно для внешних демонов, которые переживают нас). */
	async closeAll(timeoutMs = 1500): Promise<void> {
		const jobs: Promise<unknown>[] = []
		for (const [space, list] of this.ready) {
			const client = this.deps.getSpace(space)?.client
			if (client) for (const e of list) jobs.push(client.sessionClose(e.id).catch(() => undefined))
		}
		this.ready.clear()
		await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, timeoutMs).unref())])
	}

	private discard(space: string, id: string): void {
		const client = this.deps.getSpace(space)?.client
		if (client) void client.sessionClose(id).catch(() => undefined)
	}
}
