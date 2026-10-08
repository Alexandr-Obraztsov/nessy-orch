/**
 * Точка входа оркестратора: поднимает ядро, HTTP/SSE API и UI.
 * Запускается пользователем (вне песочницы) — вручную или через launchd.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildApp } from './app'
import { loadConfig } from './infrastructure/config/load-config'
import { errMsg } from './lib/json'

function version(root: string): string {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
		if (typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string') return raw.version
	} catch {
		/* нет package.json — не критично */
	}
	return '0.0.0'
}

async function main(): Promise<void> {
	const config = loadConfig()
	const app = buildApp(config, version(config.root))
	try {
		await app.listen()
	} catch (e) {
		const code = e instanceof Error && 'code' in e ? e.code : undefined
		if (code === 'EADDRINUSE') console.error(`[nessy-orch] порт ${config.port} занят — оркестратор уже запущен?`)
		else console.error('[nessy-orch] ошибка сервера:', errMsg(e))
		process.exit(1)
	}
	console.log(`[nessy-orch] http://${config.host}:${config.port}  home=${config.home}  autoApprove=${config.autoApprove}`)
	// любой выход (в т.ч. падение) гасит запущенные nessy serve, чтобы они не остались висеть
	process.on('exit', () => app.killChildrenSync())
	process.on('uncaughtException', e => {
		console.error('[nessy-orch] необработанная ошибка:', errMsg(e))
		process.exit(1)
	})
	app.start()
	if (!fs.existsSync(path.join(config.uiDir, 'index.html')))
		console.log('[nessy-orch] UI не найден в ' + config.uiDir + ' (API работает; см. ui/README.md)')

	let closing = false
	const stop = (sig: string): void => {
		if (closing) return
		closing = true
		console.log(`[nessy-orch] ${sig}: останавливаюсь`)
		void app.close().finally(() => process.exit(0))
		setTimeout(() => process.exit(0), 10000).unref()
	}
	process.on('SIGINT', () => stop('SIGINT'))
	process.on('SIGTERM', () => stop('SIGTERM'))
}

main().catch((e: unknown) => {
	console.error('[nessy-orch] фатальная ошибка:', errMsg(e))
	process.exit(1)
})
