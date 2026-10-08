import type { ChildProcess } from 'node:child_process'

/** Строка таблицы процессов (`ps -Ao pid,ppid,etime,command`). */
export interface ProcessInfo {
	pid: number
	ppid: number
	/** время работы в формате ps ([[dd-]hh:]mm:ss) */
	etime: string
	command: string
}

/** Запись о запущенном оркестратором `nessy serve` (<home>/serve-pids.json). */
export interface ServePidRecord {
	pid: number
	port: number
	workspace: string
	/** ISO-время запуска */
	startedAt: string
}

/** Учёт дочерних процессов serve: запись pid в файл и снятие при выходе. */
export interface ServeTracker {
	track(proc: ChildProcess, info: { port: number; workspace: string }): void
}

/** Результат захвата <home>/orch.lock. */
export type LockResult = { ok: true; release: () => void } | { ok: false; pid: number }
