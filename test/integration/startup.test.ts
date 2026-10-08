/**
 * Запуск оркестратора: сначала listen, потом фоновая работа; занятый порт — ничего не запущено;
 * осиротевшие serve прошлых запусков останавливаются; второй экземпляр не стартует; doctor.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import type { SpawnResponse } from '../../shared/types'
import { buildApp } from '../../src/app'
import { aliveMatching, isAlive, isServeCommand, listProcesses } from '../../src/infrastructure/process/process-table'
import { readServePids } from '../../src/infrastructure/process/serve-processes'
import { CLI, freeApiPort, startHarness, testConfig } from '../support/harness'
import { exited, runMain, spawnDummy } from '../support/procs'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 30000 }

/** Состояние с агентом, у которого в очереди ждёт сообщение «отложенное». Возвращает каталог стенда. */
async function stateWithQueue(): Promise<string> {
	const h = await startHarness()
	await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
	await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'keeper', prompt: 'привет', wait: true })
	await h.api('POST', '/agents/keeper/send', { text: '#slow' })
	await until(() => h.orch.getAgent('keeper').status === 'working', 4000, 'working')
	await h.api('POST', '/agents/keeper/send', { text: 'отложенное' })
	await h.close({ keepFiles: true })
	return h.base
}

const servesIn = (ws: string): number[] => listProcesses().filter(p => isServeCommand(p.command) && p.command.includes(ws)).map(p => p.pid)

function occupy(): Promise<{ port: number; close: () => Promise<void> }> {
	return new Promise((resolve, reject) => {
		const s = net.createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const addr = s.address()
			const port = typeof addr === 'object' && addr ? addr.port : 0
			resolve({ port, close: () => new Promise(r => s.close(() => r())) })
		})
	})
}

function cli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		execFile(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: '1', ...env } }, (err, stdout, stderr) => {
			const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0
			resolve({ code, stdout, stderr })
		})
	})
}

describe('запуск оркестратора', () => {
	const cleanup: (() => Promise<void> | void)[] = []
	after(async () => {
		for (const f of cleanup.reverse()) await f()
	})

	it('восстановленная очередь доставляется только после start(), не при buildApp/listen', T, async () => {
		const base = await stateWithQueue()
		const h = await startHarness({ base, start: false })
		cleanup.push(() => h.close())
		await new Promise(r => setTimeout(r, 300))
		assert.equal(h.orch.graph().spaces[0]?.status, 'stopped', 'serve не запущен до start()')
		assert.equal(h.orch.getAgent('keeper').queued, 1)
		assert.deepEqual(servesIn(h.ws), [])
		await h.app.start()
		await until(
			() => h.orch.listMessages({ agent: 'keeper', limit: 1000 }).some(m => m.kind === 'reply' && m.text === 'ответ: отложенное'),
			10000,
			'ответ на отложенное',
		)
		assert.equal(h.orch.getAgent('keeper').queued, 0)
		const recs = readServePids(path.join(h.home, 'serve-pids.json'))
		assert.equal(recs.length, 1, 'запущенный serve записан')
		const rec = recs[0]
		assert.ok(rec && isAlive(rec.pid))
		// синхронная остановка детей (process.on('exit'))
		const pid = rec.pid
		h.app.killChildrenSync()
		await until(() => !aliveMatching(pid, isServeCommand), 5000, 'serve остановлен')
	})

	it('порт занят: listen падает, ни одного serve не запущено (buildApp и настоящий main.js)', T, async () => {
		const base = await stateWithQueue()
		cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }))
		const busy = await occupy()
		cleanup.push(() => busy.close())

		const app = buildApp(testConfig(base, busy.port), 'test')
		await assert.rejects(app.listen(), /EADDRINUSE/)
		await new Promise(r => setTimeout(r, 300))
		assert.equal(app.orch.graph().spaces[0]?.status, 'stopped')
		await app.close()

		const ws = path.join(base, 'ws')
		const run = runMain({ NESSY_ORCH_HOME: path.join(base, 'home'), ORCH_PORT: String(busy.port), SERVE_BASE_PORT: '23400' })
		const code = await run.exit
		assert.equal(code, 1, run.output())
		assert.match(run.output(), /порт \d+ занят/)
		await new Promise(r => setTimeout(r, 300))
		assert.deepEqual(servesIn(ws), [], 'serve не осиротели')
		assert.deepEqual(readServePids(path.join(base, 'home', 'serve-pids.json')), [])
		assert.equal(fs.existsSync(path.join(base, 'home', 'orch.lock')), false, 'lock снят при выходе')
	})

	it('осиротевший serve из serve-pids.json останавливается при старте; несовпавший pid не трогается', T, async () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-test-'))
		const orphan = spawnDummy(['serve', '--workspace', '/tmp/x'])
		const stranger = spawnDummy(['something-else'])
		cleanup.push(() => {
			orphan.kill('SIGKILL')
			stranger.kill('SIGKILL')
		})
		await until(() => aliveMatching(orphan.pid ?? 0, isServeCommand), 3000, 'пустышка запущена')
		const home = path.join(base, 'home')
		fs.mkdirSync(home, { recursive: true })
		const recs = [
			{ pid: orphan.pid, port: 4999, workspace: '/tmp/x', startedAt: new Date().toISOString() },
			{ pid: stranger.pid, port: 4998, workspace: '/tmp/y', startedAt: new Date().toISOString() },
		]
		fs.writeFileSync(path.join(home, 'serve-pids.json'), JSON.stringify(recs))
		const logs: string[] = []
		const orig = console.log
		console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '))
		let h: Harness
		try {
			h = await startHarness({ base })
		} finally {
			console.log = orig
		}
		cleanup.push(() => h.close())
		assert.equal(await exited(orphan, 5000), true, 'осиротевший serve остановлен')
		assert.equal(await exited(stranger, 300), false, 'чужой процесс жив')
		assert.ok(logs.some(l => l === `[nessy-orch] остановлен осиротевший nessy serve pid=${orphan.pid} port=4999`), logs.join('\n'))
		assert.deepEqual(readServePids(path.join(home, 'serve-pids.json')), [], 'файл очищен')
	})

	it('второй экземпляр с тем же home не стартует; SIGKILL оставляет serve, следующий запуск его гасит', T, async () => {
		const base = await stateWithQueue()
		cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }))
		const home = path.join(base, 'home')
		const env = { NESSY_ORCH_HOME: home, SERVE_BASE_PORT: '23600', ORCH_UI_DIR: path.join(base, 'ui') }
		const first = runMain({ ...env, ORCH_PORT: String(await freeApiPort()) })
		cleanup.push(() => void first.proc.kill('SIGKILL'))
		// очередь доставлена → serve поднят и записан
		await until(() => readServePids(path.join(home, 'serve-pids.json')).length === 1, 15000, 'serve записан')
		assert.equal(fs.readFileSync(path.join(home, 'orch.lock'), 'utf8').trim(), String(first.proc.pid))

		const second = runMain({ ...env, ORCH_PORT: String(await freeApiPort()) })
		assert.equal(await second.exit, 1, second.output())
		assert.match(second.output(), new RegExp(`уже запущен \\(pid ${first.proc.pid}\\) — второй экземпляр не стартует`))
		assert.equal(fs.readFileSync(path.join(home, 'orch.lock'), 'utf8').trim(), String(first.proc.pid), 'lock не тронут')

		const servePid = readServePids(path.join(home, 'serve-pids.json'))[0]?.pid ?? 0
		first.proc.kill('SIGKILL') // аварийная смерть: обработчики выхода не срабатывают
		await first.exit
		await new Promise(r => setTimeout(r, 200))
		if (!aliveMatching(servePid, isServeCommand)) return // serve сам вышел вслед за родителем — проверять нечего
		const third = runMain({ ...env, ORCH_PORT: String(await freeApiPort()) })
		cleanup.push(() => void third.proc.kill('SIGKILL'))
		await until(() => third.output().includes(`остановлен осиротевший nessy serve pid=${servePid}`), 10000, 'лог об осиротевшем serve')
		assert.equal(aliveMatching(servePid, isServeCommand), false)
		third.proc.kill('SIGTERM')
		assert.equal(await third.exit, 0)
		assert.equal(fs.existsSync(path.join(home, 'orch.lock')), false, 'lock снят')
	})

	it('doctor: живой оркестратор — serve «оркестратора»; без оркестратора — записанный serve осиротевший, --fix его гасит', T, async () => {
		const h = await startHarness()
		cleanup.push(() => h.close())
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
		await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'a1', prompt: 'привет', wait: true })
		const env = { ORCH_PORT: String(h.port), NESSY_ORCH_HOME: h.home }
		const r = await cli(['doctor'], env)
		assert.equal(r.code, 0, r.stderr)
		assert.match(r.stdout, /● оркестратор: nessy-orch test {2}pid \d+/)
		assert.match(r.stdout, /Записанные serve \(serve-pids\.json\): 1/)
		const servePid = readServePids(path.join(h.home, 'serve-pids.json'))[0]?.pid
		assert.match(r.stdout, new RegExp(`pid ${servePid} {2}ppid ${process.pid} .* оркестратора `))
		assert.match(r.stdout, /main: агентов 1 \(активных 0, в архиве 1\)/)

		// оркестратор «лежит» (другой порт, другой home): записанная пустышка-serve — осиротевшая
		const down = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-test-'))
		cleanup.push(() => fs.rmSync(down, { recursive: true, force: true }))
		const orphan = spawnDummy(['serve', '--workspace', '/tmp/doctor'])
		cleanup.push(() => void orphan.kill('SIGKILL'))
		await until(() => aliveMatching(orphan.pid ?? 0, isServeCommand), 3000, 'пустышка запущена')
		fs.writeFileSync(path.join(down, 'serve-pids.json'), JSON.stringify([{ pid: orphan.pid, port: 1, workspace: '/tmp/doctor', startedAt: '' }]))
		const denv = { ORCH_PORT: String(await freeApiPort()), NESSY_ORCH_HOME: down }
		const d = await cli(['doctor'], denv)
		assert.match(d.stdout, /○ оркестратор недоступен/)
		assert.match(d.stdout, new RegExp(`pid ${orphan.pid} .* осиротевший`))
		assert.match(d.stdout, /doctor --fix/)
		assert.equal(orphan.exitCode, null, 'без --fix ничего не трогается')
		const f = await cli(['doctor', '--fix'], denv)
		assert.match(f.stdout, new RegExp(`--fix: остановлен nessy serve pid=${orphan.pid}`))
		assert.equal(await exited(orphan, 5000), true)
		assert.deepEqual(readServePids(path.join(down, 'serve-pids.json')), [])
	})
})
