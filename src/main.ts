/**
 * Точка входа оркестратора: поднимает ядро и HTTP/SSE API (клиенты — CLI и приложение TClaude-Orch).
 * Запускается пользователем (вне песочницы) — вручную или через launchd.
 */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildApp } from './app'
import { ensureToken } from './infrastructure/config/auth-token'
import { loadConfig } from './infrastructure/config/load-config'
import { acquireInstance, releaseInstance } from './infrastructure/process/single-instance'
import { compareBuild, readVersion } from './interfaces/cli/runtime'
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

/** Остановить оркестратор (node …/main.js), занявший порт. true — порт освобождён. */
async function freePort(port: number): Promise<boolean> {
	const sh = (cmd: string): string => {
		try {
			return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
		} catch {
			return ''
		}
	}
	const pids = sh(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`).split(/\s+/).filter(Boolean).map(Number).filter(p => p !== process.pid)
	const ours = pids.filter(p => /main\.js/.test(sh(`ps -o command= -p ${p}`)))
	if (!ours.length) return false
	for (const p of ours) process.kill(p, 'SIGTERM')
	for (let i = 0; i < 40 && ours.some(p => sh(`ps -o pid= -p ${p}`)); i++) await new Promise(r => setTimeout(r, 250))
	for (const p of ours) if (sh(`ps -o pid= -p ${p}`)) process.kill(p, 'SIGKILL')
	await new Promise(r => setTimeout(r, 500))
	return true
}

async function main(): Promise<void> {
	const config = loadConfig()
	config.authToken = ensureToken(config.home)
	config.authRequired = true
	// один оркестратор на home: прежний (старее или такой же) просим уйти и забираем замок; новее нас — уходим сами (код 0: launchd не зацикливает)
	const build = readVersion(config.root)
	const lock = await acquireInstance(config.home, build, { compare: compareBuild })
	if (!lock.ok) {
		console.log(`[nessy-orch] уже работает более новая сборка (pid ${lock.holder.pid}, ${lock.holder.build ?? '?'}): выхожу`)
		process.exit(0)
	}
	if (lock.tookOver !== null) console.log(`[nessy-orch] прежний процесс ${lock.tookOver} остановлен, продолжаю я`)
	process.on('exit', () => releaseInstance(config.home))
	const app = buildApp(config, version(config.root))
	try {
		await app.listen().catch(async (e: unknown) => {
			// порт держит процесс без замка (старая сборка до замков): если это наш оркестратор — останавливаем и пробуем ещё раз
			if (!(e instanceof Error && 'code' in e && e.code === 'EADDRINUSE') || !(await freePort(config.port))) throw e
			await app.listen()
		})
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
