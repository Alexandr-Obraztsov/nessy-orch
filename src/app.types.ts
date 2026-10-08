import type * as http from 'node:http'
import type { Orchestrator } from './application/orchestrator'

export interface AppInstance {
	orch: Orchestrator
	server: http.Server
	/** начать слушать config.host:config.port */
	listen(): Promise<void>
	/** начать фоновую работу (доставка восстановленных очередей) — после успешного listen */
	start(): void
	/** синхронно погасить запущенные nessy serve (на выходе процесса) */
	killChildrenSync(): void
	/** закрыть HTTP, отцепить агентов, остановить serve, записать состояние */
	close(): Promise<void>
}
