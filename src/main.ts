/**
 * Точка входа оркестратора: поднимает ядро, HTTP/SSE API и UI.
 * Запускается пользователем (вне песочницы) — вручную или через launchd.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createServer } from './api/server'
import { loadConfig } from './core/config'
import { errMsg } from './core/json'
import { Orchestrator } from './core/orchestrator'

function version(root: string): string {
	try {
		const raw: unknown = JSON.parse(
			fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
		)
		if (
			typeof raw === 'object' &&
			raw !== null &&
			'version' in raw &&
			typeof raw.version === 'string'
		)
			return raw.version
	} catch {
		/* нет package.json — не критично */
	}
	return '0.0.0'
}

async function main(): Promise<void> {
	const config = loadConfig()
	const orch = new Orchestrator(config)
	orch.load()

	const server = createServer(orch, {
		version: version(config.root),
		uiDir: config.uiDir,
		port: config.port,
		host: config.host,
	})

	server.on('error', (e: NodeJS.ErrnoException) => {
		if (e.code === 'EADDRINUSE')
			console.error(
				`[nessy-orch] порт ${config.port} занят — оркестратор уже запущен?`,
			)
		else console.error('[nessy-orch] ошибка сервера:', errMsg(e))
		process.exit(1)
	})

	server.listen(config.port, config.host, () => {
		console.log(
			`[nessy-orch] http://${config.host}:${config.port}  home=${config.home}  autoApprove=${config.autoApprove}`,
		)
		if (!fs.existsSync(path.join(config.uiDir, 'index.html')))
			console.log('[nessy-orch] UI не найден в ' + config.uiDir + ' (API работает; см. ui/README.md)')
	})

	let closing = false
	const stop = (sig: string): void => {
		if (closing) return
		closing = true
		console.log(`[nessy-orch] ${sig}: останавливаюсь`)
		server.closeAllConnections()
		server.close()
		void orch.shutdown().finally(() => process.exit(0))
		setTimeout(() => process.exit(0), 10000).unref()
	}
	process.on('SIGINT', () => stop('SIGINT'))
	process.on('SIGTERM', () => stop('SIGTERM'))
}

main().catch((e: unknown) => {
	console.error('[nessy-orch] фатальная ошибка:', errMsg(e))
	process.exit(1)
})
