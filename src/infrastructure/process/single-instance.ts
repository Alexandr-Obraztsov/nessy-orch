/**
 * Один оркестратор на домашнюю папку: замок `<home>/orch.lock` {pid, build}. Новый процесс не ждёт, пока старый «сам разберётся»:
 * если замок держит живой процесс старее (или такой же сборки) — просит его завершиться (SIGTERM: тот сохраняет состояние и гасит nessy serve),
 * через паузу добивает (SIGKILL) и занимает замок. Если замок держит более новая сборка — новый выходит (старая версия приложения
 * не затирает свежую службу). Мёртвый pid в замке — просто устаревший замок.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface LockInfo {
	pid: number
	build: string | null
	startedAt: number
}

export type Acquire = { ok: true; tookOver: number | null } | { ok: false; holder: LockInfo }

export interface InstanceDeps {
	/** >0 — a новее b */
	compare: (a: string | null, b: string | null) => number
	isAlive?: (pid: number) => boolean
	signal?: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => void
	sleep?: (ms: number) => Promise<void>
	/** сколько ждать после SIGTERM до SIGKILL */
	termWaitMs?: number
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

export async function acquireInstance(home: string, build: string | null, deps: InstanceDeps): Promise<Acquire> {
	const isAlive = deps.isAlive ?? alive
	const signal = deps.signal ?? ((pid, sig) => process.kill(pid, sig))
	const sleep = deps.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
	const termWait = deps.termWaitMs ?? 12_000
	let tookOver: number | null = null
	const held = readLock(home)
	if (held && held.pid !== process.pid && isAlive(held.pid)) {
		if (deps.compare(held.build, build) > 0) return { ok: false, holder: held }
		tookOver = held.pid
		try {
			signal(held.pid, 'SIGTERM')
		} catch {
			/* уже ушёл */
		}
		for (let waited = 0; waited < termWait && isAlive(held.pid); waited += 200) await sleep(200)
		if (isAlive(held.pid)) {
			try {
				signal(held.pid, 'SIGKILL')
			} catch {
				/* уже ушёл */
			}
			for (let i = 0; i < 10 && isAlive(held.pid); i++) await sleep(200)
		}
	}
	fs.mkdirSync(home, { recursive: true })
	const info: LockInfo = { pid: process.pid, build, startedAt: Date.now() }
	fs.writeFileSync(lockPath(home), JSON.stringify(info))
	return { ok: true, tookOver }
}

/** Снять свой замок (чужой не трогаем). */
export function releaseInstance(home: string): void {
	try {
		if (readLock(home)?.pid === process.pid) fs.unlinkSync(lockPath(home))
	} catch {
		/* нечего снимать */
	}
}
