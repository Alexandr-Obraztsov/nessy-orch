/**
 * Сборка приложения из слоёв (composition root): конфигурация → хранилище → пространства →
 * ядро → HTTP. Используется точкой входа src/main.ts и интеграционными тестами.
 */
import type * as http from 'node:http'
import * as path from 'node:path'
import { Orchestrator } from './application/orchestrator'
import type { RolePresetSource } from './application/ports'
import type { AppInstance } from './app.types'
import type { Config } from './infrastructure/config/config.types'
import { NessyClient } from './infrastructure/nessy/nessy-client'
import { FileRolePresets } from './infrastructure/persistence/role-presets'
import { FileStore } from './infrastructure/persistence/file-store'
import { ServeSpace } from './infrastructure/process/serve-space'
import { SERVE_PIDS_FILE, ServeProcesses } from './infrastructure/process/serve-processes'
import { createServer } from './interfaces/http/server'

export function buildApp(config: Config, version: string): AppInstance {
	const store = new FileStore(config.home)
	const usedPorts = new Set<number>()
	const processes = new ServeProcesses(path.join(config.home, SERVE_PIDS_FILE))
	const orch = new Orchestrator({
		settings: config,
		store,
		spaceFactory: (init, listener) =>
			new ServeSpace(
				init,
				{
					settings: config,
					usedPorts,
					logPath: name => store.logPath(name),
					makeClient: url => new NessyClient(url),
					processes,
				},
				listener,
			),
	})
	// первый запуск (roles.json ещё нет): готовые роли из <root>/roles
	const firstStart = !orch.hasStoredRoles
	// только чтение состояния: serve и сессии поднимаются в start(), когда HTTP уже слушает
	orch.load()
	if (config.seedRoles && firstStart) seedRoles(orch, new FileRolePresets(config.rolesDir))
	let started: Promise<void> | null = null
	const server = createServer(orch, { version, uiDir: config.uiDir, port: config.port, host: config.host })

	return {
		orch,
		server,
		listen: () =>
			new Promise<void>((resolve, reject) => {
				const onError = (e: Error): void => reject(e)
				server.once('error', onError)
				server.listen(config.port, config.host, () => {
					server.off('error', onError)
					resolve()
				})
			}),
		start: () =>
			(started ??= (async () => {
				await processes.cleanupOrphans()
				await orch.start()
			})()),
		killChildrenSync: () => processes.killAllSync(),
		close: async () => {
			server.closeAllConnections()
			await new Promise<void>(r => closeServer(server, r))
			await orch.shutdown()
		},
	}
}

function seedRoles(orch: Orchestrator, source: RolePresetSource): void {
	const { added, invalid } = orch.seedRoles(source.read())
	if (added.length || invalid.length)
		console.log(`[nessy-orch] роли по умолчанию: добавлено ${added.length}${invalid.length ? `, пропущено невалидных ${invalid.length}` : ''}`)
}

function closeServer(server: http.Server, done: () => void): void {
	if (!server.listening) {
		done()
		return
	}
	server.close(() => done())
}
