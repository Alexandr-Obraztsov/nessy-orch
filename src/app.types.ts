import type * as http from 'node:http'
import type { Orchestrator } from './application/orchestrator'

export interface AppInstance {
	orch: Orchestrator
	server: http.Server
	/** начать слушать config.host:config.port */
	listen(): Promise<void>
	/**
	 * Фоновая работа — только после успешного listen(): остановить осиротевшие serve прошлых запусков,
	 * затем доставить восстановленные очереди (по одному агенту). Повторный вызов — тот же промис.
	 */
	start(): Promise<void>
	/** Синхронно послать SIGTERM всем запущенным serve (process.on('exit'), аварийный выход). */
	killChildrenSync(): void
	/** закрыть HTTP, отцепить агентов, остановить serve, записать состояние */
	close(): Promise<void>
}
