/**
 * TclaudeSpace — пространство поверх headless tclaude (Claude Code) рантайма. Сессия агента = живой процесс
 * tclaude с изолированным HOME; порт (TclaudeAgentPort) один на пространство, сессии — отдельные процессы.
 * `ensureReady()` возвращает общий для пространства AgentPort; модель по умолчанию берётся из init/config.
 */
import type { RuntimeId, SpaceStatus, SpaceView } from '../../../shared/types'
import type { AgentPort } from '../../application/agent-port'
import type { SpaceInit, SpaceListener, SpaceRuntime } from '../../application/ports'
import { TclaudeAgentPort } from '../tclaude/agent-port-tclaude'

export interface TclaudeSpaceOptions {
	/** путь к бинарю tclaude (по умолчанию — конфиг, далее TCLAUDE_PATH). */
	bin?: string
	/** модель по умолчанию для новых сессий (null — дефолт рантайма). */
	model?: string | null
	/** режим разрешений --permission-mode; безопасный дефолт — 'default'. */
	permissionMode?: string
}

export class TclaudeSpace implements SpaceRuntime {
	readonly name: string
	readonly path: string
	readonly url: string | null = null
	readonly color: number
	readonly runtime: RuntimeId = 'tclaude'
	readonly model: string | null
	status: SpaceStatus = 'ready'
	client: AgentPort | null = null

	private readonly opts: TclaudeSpaceOptions

	constructor(
		init: SpaceInit,
		opts: TclaudeSpaceOptions,
		// слушатель статуса не используется: у tclaude пространства нет демона, статус всегда «ready»
		_listener: SpaceListener,
	) {
		this.name = init.name
		this.path = init.path
		this.color = init.color ?? 210
		this.model = init.model ?? opts.model ?? null
		this.opts = opts
	}

	ensureReady(): Promise<AgentPort> {
		this.client ??= new TclaudeAgentPort({
			...(this.opts.bin !== undefined ? { bin: this.opts.bin } : {}),
			...(this.model !== null ? { model: this.model } : {}),
			...(this.opts.permissionMode !== undefined ? { permissionMode: this.opts.permissionMode } : {}),
		})
		return Promise.resolve(this.client)
	}

	stop(): Promise<void> {
		// закрываем сессии адаптера: иначе их CLI-процессы tclaude останутся осиротевшими после остановки
		const client = this.client as TclaudeAgentPort | null
		this.client = null
		return client ? client.closeAll() : Promise.resolve()
	}

	killSync(): void {
		// синхронный вариант на выход процесса: закрыть сессии в фоне (процессы получат SIGINT внутри sessionClose)
		const client = this.client as TclaudeAgentPort | null
		this.client = null
		if (client) void client.closeAll()
	}

	toJSON(): SpaceView {
		return { name: this.name, path: this.path, color: this.color, mode: 'managed', url: null, status: this.status, error: null, runtime: this.runtime }
	}
}
