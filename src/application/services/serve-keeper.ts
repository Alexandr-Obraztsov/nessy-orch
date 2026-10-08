/**
 * ServeKeeper — бережёт процессы nessy serve. Каждое управляемое пространство — отдельный `nessy serve`
 * со своим ACP-рантаймом и MCP-серверами, поэтому:
 *   • serve, простаивающий serveIdleMin минут, останавливается: агенты отцепляются и при следующем
 *     сообщении поднимают прежние сессии через /load (как после рестарта оркестратора);
 *   • одновременно запущено не больше maxServes: перед запуском нового останавливается самый давно
 *     активный из простаивающих; если простаивающих нет — запускаем сверх лимита с предупреждением.
 * Простой — ни один агент пространства не держит serve (Agent.holdsServe). Внешние пространства (url) не трогаются.
 */
import { DEFAULT_MAX_SERVES, DEFAULT_SERVE_IDLE_MIN } from '../../domain/constants'
import type { NessyGateway, SpaceRuntime } from '../ports'
import type { ServiceContext } from './context.types'

const MINUTE_MS = 60_000
/** как часто проверять простой */
const SWEEP_MS = 30_000

/** serve запущен или запускается. */
const isRunning = (s: SpaceRuntime): boolean => s.status === 'ready' || s.status === 'starting'

export class ServeKeeper {
	/** последняя активность по пространствам, мс (часы ctx.clock) */
	private readonly lastActive = new Map<string, number>()
	/** решения о лимите принимаются по очереди, чтобы два запуска не заняли одно место */
	private gate: Promise<unknown> = Promise.resolve()
	private timer: NodeJS.Timeout | null = null

	constructor(
		private readonly ctx: ServiceContext,
		private readonly log: (line: string) => void,
	) {}

	get idleMin(): number {
		return Math.max(0, this.ctx.settings.serveIdleMin ?? DEFAULT_SERVE_IDLE_MIN)
	}

	get maxServes(): number {
		return Math.max(0, this.ctx.settings.maxServes ?? DEFAULT_MAX_SERVES)
	}

	/** Запущенные (и запускающиеся) управляемые serve. */
	running(): SpaceRuntime[] {
		return [...this.ctx.registry.spaces.values()].filter(s => s.managed && isRunning(s))
	}

	note(space: string): void {
		this.lastActive.set(space, this.ctx.clock.now())
	}

	forget(space: string): void {
		this.lastActive.delete(space)
	}

	/** Секунд без активности у запущенного управляемого serve (null — не запущен, внешний или активности ещё не было). */
	idleSec(space: SpaceRuntime): number | null {
		if (!space.managed || !isRunning(space)) return null
		const t = this.lastActive.get(space.name)
		return t === undefined ? null : Math.max(0, Math.floor((this.ctx.clock.now() - t) / 1000))
	}

	/** Ни один агент пространства не держит serve. */
	isIdle(space: SpaceRuntime): boolean {
		for (const a of this.ctx.registry.agents.values()) if (a.space === space.name && a.holdsServe) return false
		return true
	}

	/** Поднять serve пространства; если запускается новый управляемый serve — сначала освободить место под лимит. */
	async ensureReady(space: SpaceRuntime): Promise<NessyGateway> {
		this.note(space.name)
		let started: Promise<NessyGateway>
		if (space.managed && !isRunning(space)) {
			// в очереди только решение и старт запуска (статус сразу становится starting), а не весь запуск
			const turn = this.gate.then(async () => {
				await this.makeRoom(space)
				const p = space.ensureReady()
				p.catch(() => undefined)
				return { p }
			})
			this.gate = turn.catch(() => undefined)
			started = (await turn).p
		} else {
			started = space.ensureReady()
		}
		const client = await started
		this.note(space.name)
		return client
	}

	/** Под лимит: остановить самые давно активные простаивающие serve (таймер простоя не важен). */
	private async makeRoom(space: SpaceRuntime): Promise<void> {
		const max = this.maxServes
		if (max <= 0) return
		const others = this.running().filter(s => s !== space)
		let count = others.length
		if (count < max) return
		const idle = others.filter(s => s.status === 'ready' && this.isIdle(s)).sort((a, b) => this.lastOf(a) - this.lastOf(b))
		for (const s of idle) {
			if (count < max) break
			if (await this.stopSpace(s, `лимит ORCH_MAX_SERVES=${max}, нужен serve для «${space.name}»`)) count--
		}
		if (count >= max) this.log(`[nessy-orch] запущено ${count + 1} nessy serve при лимите ${max} — все заняты`)
	}

	private lastOf(space: SpaceRuntime): number {
		return this.lastActive.get(space.name) ?? 0
	}

	/** Остановить serve простаивающего пространства. false — пространство уже не простаивает. */
	private async stopSpace(space: SpaceRuntime, why: string): Promise<boolean> {
		if (!space.managed || space.status !== 'ready' || !this.isIdle(space)) return false
		// синхронно до stop(): новое сообщение после этого дождётся остановки и поднимет serve заново
		for (const a of this.ctx.registry.agents.values()) if (a.space === space.name) a.suspend()
		this.forget(space.name)
		this.log(`[nessy-orch] останавливаю nessy serve пространства «${space.name}»: ${why}`)
		await space.stop()
		return true
	}

	/** Остановить serve, простаивающие дольше serveIdleMin. Возвращает имена остановленных пространств. */
	async sweep(): Promise<string[]> {
		const idleMs = this.idleMin * MINUTE_MS
		if (idleMs <= 0 || this.ctx.isShuttingDown()) return []
		const now = this.ctx.clock.now()
		const stopped: string[] = []
		for (const s of this.running()) {
			if (s.status !== 'ready') continue
			const t = this.lastActive.get(s.name)
			if (t === undefined) {
				this.note(s.name) // serve подняли в обход ensureReady — отсчёт с текущего момента
				continue
			}
			if (now - t < idleMs || !this.isIdle(s)) continue
			if (await this.stopSpace(s, `простой ${Math.round((now - t) / MINUTE_MS)} мин (ORCH_SERVE_IDLE_MIN=${this.idleMin})`)) stopped.push(s.name)
		}
		return stopped
	}

	/** Периодическая проверка простоя (не держит процесс). */
	start(): void {
		if (this.timer || this.idleMin <= 0) return
		this.timer = setInterval(() => void this.sweep().catch(() => undefined), Math.min(SWEEP_MS, this.idleMin * MINUTE_MS))
		this.timer.unref()
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer)
		this.timer = null
	}
}
