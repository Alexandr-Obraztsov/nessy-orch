/**
 * Сборка приложения из слоёв (composition root): конфигурация → хранилище → пространства →
 * ядро → HTTP. Используется точкой входа src/main.ts и интеграционными тестами.
 */
import * as fs from 'node:fs'
import type * as http from 'node:http'
import * as path from 'node:path'
import { Orchestrator } from './application/orchestrator'
import { parseRolePreset } from './domain/role-presets'
import type { RolePresetFile } from './domain/types'
import type { RolePresetSource } from './application/ports'
import type { AppInstance } from './app.types'
import type { Config } from './infrastructure/config/config.types'
import { NessyClient } from './infrastructure/nessy/nessy-client'
import { FileRolePackages } from './infrastructure/persistence/role-packages'
import { FileRolePresets } from './infrastructure/persistence/role-presets'
import { FileLearningStore } from './infrastructure/persistence/learning-store'
import { FileStore } from './infrastructure/persistence/file-store'
import { ServeSpace } from './infrastructure/process/serve-space'
import { createServer } from './interfaces/http/server'

export function buildApp(config: Config, version: string): AppInstance {
	const store = new FileStore(config.home)
	const usedPorts = new Set<number>()
	const orch = new Orchestrator({
		settings: config,
		store,
		rolePackages: new FileRolePackages(path.join(config.home, 'role-packages')),
		learningStore: new FileLearningStore(config.home, config.root),
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
	// готовые роли из <root>/roles: при первом запуске все, потом только новые (уже виденные и удалённые пользователем не возвращаются)
	const firstStart = !orch.hasStoredRoles
	orch.load()
	if (config.seedRoles) seedRoles(orch, new FileRolePresets(config.rolesDir), path.join(config.home, 'roles-seen.json'), firstStart)
	const server = createServer(orch, { version, port: config.port, host: config.host, ...(config.authToken ? { token: config.authToken } : {}) })

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

/** Роли, появившиеся в поставке позже первого запуска, но раньше учёта «уже виденных»: у существующих установок их ещё нет. */
const ADDED_BEFORE_TRACKING = ['html-writer']

function seedRoles(orch: Orchestrator, source: RolePresetSource, seenPath: string, firstStart: boolean): void {
	let seen: Set<string> | null = null
	try {
		const j: unknown = JSON.parse(fs.readFileSync(seenPath, 'utf8'))
		if (Array.isArray(j)) seen = new Set(j.filter((x): x is string => typeof x === 'string'))
	} catch {
		/* учёта ещё нет */
	}
	const files = source.read()
	const ids = new Map<RolePresetFile, string>()
	for (const f of files) {
		try {
			ids.set(f, parseRolePreset(f.text).id ?? '')
		} catch {
			ids.set(f, '') // невалидный пресет попадёт в счётчик invalid
		}
	}
	const existing = new Set(orch.listRoles().map(r => r.id))
	// учёта нет, а роли уже были (установка до учёта): всё, что в поставке, кроме недавних, считаем виденным
	if (!seen) seen = new Set(firstStart ? [] : [...existing, ...[...ids.values()].filter(id => id && !ADDED_BEFORE_TRACKING.includes(id))])
	const fresh = files.filter(f => firstStart || !seen.has(ids.get(f) ?? '') ? !existing.has(ids.get(f) ?? '') : false)
	const { added, invalid } = orch.seedRoles(fresh)
	for (const id of ids.values()) if (id) seen.add(id)
	try {
		fs.writeFileSync(seenPath, JSON.stringify([...seen].sort()))
	} catch {
		/* учёт не критичен: в худшем случае роль предложится при следующем запуске */
	}
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
