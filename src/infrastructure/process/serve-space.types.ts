import type { NessyGateway } from '../../application/ports'

/** Параметры запуска `nessy serve` (подмножество Config). */
export interface ServeSettings {
	nessyBin: string
	nessyServeArgs: string[]
	serveBasePort: number
	maxSessionsPerSpace: number
	healthTimeoutMs: number
}

export interface ServeSpaceDeps {
	settings: ServeSettings
	/** порты, занятые serve других пространств (общий набор) */
	usedPorts: Set<number>
	/** файл лога serve для пространства */
	logPath: (spaceName: string) => string
	makeClient: (baseUrl: string) => NessyGateway
}
