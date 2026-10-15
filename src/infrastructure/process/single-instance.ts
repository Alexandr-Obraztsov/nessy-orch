/**
 * Один оркестратор на домашнюю папку: замок `<home>/orch.lock` {pid, build}. Если замок держит живой процесс — новый ничего не запускает
 * и уходит (используем работающий, любой сборки: обновление службы — явный перезапуск `install --ensure`/приложения, а не гонка процессов).
 * Мёртвый pid в замке — устаревший замок.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface LockInfo {
	pid: number
	build: string | null
	startedAt: number
}

export type Acquire = { ok: true } | { ok: false; holder: LockInfo }

export interface InstanceDeps {
	isAlive?: (pid: number) => boolean
}

const lockPath = (home: string): string => path.join(home, 'orch.lock')

export function readLock(home: string): LockInfo | null {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(lockPath(home), 'utf8'))
		if (typeof raw !== 'object' || raw === null) return null
		const o = raw as Record<string, unknown>
		if (typeof o['pid'] !== 'number') return null
		return { pid: o['pid'], build: typeof o['build'] === 'string' ? o['build'] : null, startedAt: typeof o['startedAt'] === 'number' ? o['startedAt'] : 0 }
	} catch {
		return null
	}
}

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return e instanceof Error && 'code' in e && e.code === 'EPERM'
	}
}

export function acquireInstance(home: string, build: string | null, deps: InstanceDeps = {}): Acquire {
	const isAlive = deps.isAlive ?? alive
	const held = readLock(home)
	if (held && held.pid !== process.pid && isAlive(held.pid)) return { ok: false, holder: held }
	fs.mkdirSync(home, { recursive: true })
	const info: LockInfo = { pid: process.pid, build, startedAt: Date.now() }
	fs.writeFileSync(lockPath(home), JSON.stringify(info))
	return { ok: true }
}

/** Снять свой замок (чужой не трогаем). */
export function releaseInstance(home: string): void {
	try {
		if (readLock(home)?.pid === process.pid) fs.unlinkSync(lockPath(home))
	} catch {
		/* нечего снимать */
	}
}
