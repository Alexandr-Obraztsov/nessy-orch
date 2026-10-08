/**
 * Таблица процессов ОС: жив ли pid, его командная строка, список процессов, мягкое завершение.
 * Через `ps` — одинаково работает на macOS и Linux.
 */
import { execFileSync } from 'node:child_process'
import { sleep } from '../../lib/async'
import type { ProcessInfo } from './process.types'

const POLL_MS = 100

/** Процесс существует (EPERM — существует, но чужой). */
export function isAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return e instanceof Error && 'code' in e && e.code === 'EPERM'
	}
}

/** Командная строка процесса или null (процесса нет / ps недоступен). */
export function commandLine(pid: number): string | null {
	if (!Number.isInteger(pid) || pid <= 0) return null
	try {
		const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
		return out || null
	} catch {
		return null
	}
}

/** Похоже на `nessy serve`, запущенный оркестратором (`… serve … --workspace …`). */
export function isServeCommand(cmd: string): boolean {
	return / serve( |$)/.test(cmd) && cmd.includes('--workspace')
}

/** Похоже на процесс оркестратора (`node …/dist/src/main.js`). */
export function isOrchCommand(cmd: string): boolean {
	return cmd.includes('dist/src/main.js')
}

/** pid жив и его командная строка проходит проверку (зомби `<defunct>` не проходит). */
export function aliveMatching(pid: number, match: (cmd: string) => boolean): boolean {
	if (!isAlive(pid)) return false
	const cmd = commandLine(pid)
	return cmd !== null && match(cmd)
}

/** Все процессы машины (пусто, если ps недоступен). */
export function listProcesses(): ProcessInfo[] {
	let out: string
	try {
		out = execFileSync('ps', ['-Ao', 'pid=,ppid=,etime=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })
	} catch {
		return []
	}
	const list: ProcessInfo[] = []
	for (const line of out.split('\n')) {
		const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
		if (!m) continue
		list.push({ pid: Number(m[1]), ppid: Number(m[2]), etime: m[3] ?? '', command: m[4] ?? '' })
	}
	return list
}

/**
 * Завершить процесс: SIGTERM, ждать до graceMs, затем SIGKILL.
 * Сигнал шлётся, только если командная строка проходит `match` (защита от переиспользованного pid).
 * true — процесс был и остановлен.
 */
export async function terminate(pid: number, match: (cmd: string) => boolean, graceMs = 3000): Promise<boolean> {
	if (!aliveMatching(pid, match)) return false
	try {
		process.kill(pid, 'SIGTERM')
	} catch {
		return false
	}
	const t0 = Date.now()
	while (Date.now() - t0 < graceMs) {
		await sleep(POLL_MS)
		if (!aliveMatching(pid, match)) return true
	}
	try {
		process.kill(pid, 'SIGKILL')
	} catch {
		/* успел выйти сам */
	}
	return true
}
