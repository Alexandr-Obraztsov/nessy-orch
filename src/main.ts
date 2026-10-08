/**
 * Точка входа оркестратора: поднимает ядро, HTTP/SSE API и UI.
 * Запускается пользователем (вне песочницы) — вручную или через launchd.
 *
 * Порядок: lock (второй экземпляр уходит сразу) → состояние → listen → и только потом фоновая работа
 * (осиротевшие serve, восстановленные очереди). Если порт занят — выходим, ничего не запустив.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildApp } from './app'
import type { AppInstance } from './app.types'
import { loadConfig } from './infrastructure/config/load-config'
import { acquireLock } from './infrastructure/process/instance-lock'
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
	// второй экземпляр (ручной запуск рядом с launchd) уходит, не трогая состояние и не запуская serve
	const lock = acquireLock(config.home)
	if (!lock.ok) {
		console.error(`[nessy-orch] уже запущен (pid ${lock.pid}) — второй экземпляр не стартует`)
		process.exit(1)
	}
	let app: AppInstance | null = null
	// на любом пути выхода гасим дочерние nessy serve: process.exit сам их не убивает
	process.on('exit', () => {
		app?.killChildrenSync()
		lock.release()
	})
	const fatal =
		(kind: string) =>
		(e: unknown): void => {
			console.error(`[nessy-orch] ${kind}:`, e instanceof Error && e.stack ? e.stack : errMsg(e))
			app?.killChildrenSync()
			process.exit(1)
		}
	process.on('uncaughtException', fatal('необработанное исключение'))
	process.on('unhandledRejection', fatal('необработанный отказ промиса'))

	const started = buildApp(config, version(config.root))
	app = started
	try {
		await started.listen()
	} catch (e) {
		const code = e instanceof Error && 'code' in e ? e.code : undefined
		if (code === 'EADDRINUSE') console.error(`[nessy-orch] порт ${config.port} занят — оркестратор уже запущен?`)
		else console.error('[nessy-orch] ошибка сервера:', errMsg(e))
		process.exit(1)
	}
	console.log(`[nessy-orch] http://${config.host}:${config.port}  home=${config.home}  autoApprove=${config.autoApprove}`)
	if (!fs.existsSync(path.join(config.uiDir, 'index.html')))
		console.log('[nessy-orch] UI не найден в ' + config.uiDir + ' (API работает; см. ui/README.md)')

	let closing = false
	const stop = (sig: string): void => {
		if (closing) return
		closing = true
		console.log(`[nessy-orch] ${sig}: останавливаюсь`)
		void started.close().finally(() => process.exit(0))
		setTimeout(() => process.exit(0), 10000).unref()
	}
	process.on('SIGINT', () => stop('SIGINT'))
	process.on('SIGTERM', () => stop('SIGTERM'))

	// фоновая работа — только теперь, когда порт наш: осиротевшие serve, восстановленные очереди
	started.start().catch((e: unknown) => console.error('[nessy-orch] ошибка фонового запуска:', errMsg(e)))
}

main().catch((e: unknown) => {
	console.error('[nessy-orch] фатальная ошибка:', errMsg(e))
	process.exit(1)
})
