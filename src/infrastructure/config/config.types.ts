import type { OrchSettings } from '../../application/settings.types'

/** Полная конфигурация процесса оркестратора (из переменных окружения). */
export interface Config extends OrchSettings {
	/** корень проекта (где package.json) */
	root: string
	host: string
	port: number
	nessyBin: string
	nessyServeArgs: string[]
	serveBasePort: number
	maxSessionsPerSpace: number
	healthTimeoutMs: number
	uiDir: string
}
