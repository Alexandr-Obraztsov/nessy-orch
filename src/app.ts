/**
 * Сборка приложения из слоёв (composition root): конфигурация → хранилище → пространства →
 * ядро → HTTP. Используется точкой входа src/main.ts и интеграционными тестами.
 */
import type * as http from 'node:http'
import { Orchestrator } from './application/orchestrator'
import type { RolePresetSource } from './application/ports'
import type { AppInstance } from './app.types'
import type { Config } from './infrastructure/config/config.types'
import { NessyClient } from './infrastructure/nessy/nessy-client'
import { FileRolePresets } from './infrastructure/persistence/role-presets'
import { FileStore } from './infrastructure/persistence/file-store'
import { ServeSpace } from './infrastructure/process/serve-space'
import { createServer } from './interfaces/http/server'

export function buildApp(config: Config, version: string): AppInstance {
	const store = new FileStore(config.home)
	const usedPorts = new Set<number>()
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
				},
				listener,
			),
	})
	// первый запуск (roles.json ещё нет): готовые роли из <root>/roles
	const firstStart = !orch.hasStoredRoles
	orch.load()
	if (config.seedRoles && firstStart) seedRoles(orch, new FileRolePresets(config.rolesDir))
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
		start: () => orch.start(),
		killChildrenSync: () => orch.killChildrenSync(),
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
