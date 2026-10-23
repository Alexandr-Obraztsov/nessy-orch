/**
 * NessySdkSpace — пространство поверх nessy-sdk рантайма (§6б дизайна). Процесса serve здесь нет: агент работает
 * в отдельном CLI-процессе, который поднимает сам адаптер (NessySdkAgentPort). Пространство — только воркспейс
 * и единый порт для всех сессий. `ensureReady()` возвращает общий для пространства AgentPort.
 */
import type { SpaceStatus, SpaceView } from '../../../shared/types'
import type { AgentPort } from '../../application/agent-port'
import type { SpaceInit, SpaceListener, SpaceRuntime } from '../../application/ports'
import { NessySdkAgentPort, type NessySdkAgentPortOptions } from '../nessy/agent-port-sdk'

export interface SdkSpaceOptions {
	/** ожидаемая модель для верификации по system/init; не задана — верификация не выполняется. */
	model?: string
	/** права адаптера; по умолчанию 'default' (write-инструменты через canUseTool). */
	permissionMode?: NessySdkAgentPortOptions['permissionMode']
}

export class NessySdkSpace implements SpaceRuntime {
	readonly name: string
	readonly path: string
	readonly url: string | null = null
	readonly color: number
	status: SpaceStatus = 'ready'
	client: AgentPort | null = null

	private readonly opts: SdkSpaceOptions

	constructor(
		init: SpaceInit,
		opts: SdkSpaceOptions,
		// слушатель статуса не используется: у nessy-sdk пространства нет процессов, статус всегда «ready»
		_listener: SpaceListener,
	) {
		this.name = init.name
		this.path = init.path
		this.color = init.color ?? 210
		this.opts = opts
	}

	ensureReady(): Promise<AgentPort> {
		this.client ??= new NessySdkAgentPort({
			cwd: this.path,
			...(this.opts.model !== undefined ? { model: this.opts.model } : {}),
			...(this.opts.permissionMode !== undefined ? { permissionMode: this.opts.permissionMode } : {}),
		})
		return Promise.resolve(this.client)
	}

	stop(): Promise<void> {
		// закрываем сессии адаптера: иначе их CLI-процессы nessy (и MCP-серверы) останутся осиротевшими после остановки
		const client = this.client as NessySdkAgentPort | null
		this.client = null
		return client ? client.closeAll() : Promise.resolve()
	}

	killSync(): void {
		// синхронный вариант на выход процесса: закрыть сессии в фоне (CLI-процессы получат SIGINT через interrupt внутри sessionClose)
		const client = this.client as NessySdkAgentPort | null
		this.client = null
		if (client) void client.closeAll()
	}

	toJSON(): SpaceView {
		return { name: this.name, path: this.path, color: this.color, mode: this.url ? 'external' : 'managed', url: null, status: this.status, error: null }
	}
}
