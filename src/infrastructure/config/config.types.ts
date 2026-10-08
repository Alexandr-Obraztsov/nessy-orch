import type { OrchSettings } from '../../application/settings.types'

/** Полная конфигурация процесса оркестратора (из переменных окружения). */
export interface Config extends OrchSettings {
	/** корень проекта (где package.json) */
	root: string
	host: string
	port: number
	nessyBin: string
	nessyServeArgs: string[]
	/** токен nessy serve (NESSY_SERVER_TOKEN): если задан, serve требует `Authorization: Bearer` на всех запросах */
	nessyToken: string | null
	serveBasePort: number
	maxSessionsPerSpace: number
	healthTimeoutMs: number
	uiDir: string
	/** заливать пресеты ролей при первом запуске (ORCH_SEED_ROLES) */
	seedRoles: boolean
	/** каталог готовых ролей (по умолчанию <root>/roles) */
	rolesDir: string
}
