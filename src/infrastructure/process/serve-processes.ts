/**
 * ServeProcesses — учёт процессов `nessy serve`, запущенных оркестратором.
 *
 *   <home>/serve-pids.json   [{ pid, port, workspace, startedAt }]
 *
 * Зачем: процессы-потомки переживают аварийный выход оркестратора (process.exit их не убивает).
 * Записи позволяют при следующем старте найти и остановить «осиротевшие» serve,
 * а killAllSync() — погасить живых детей в обработчике process.on('exit').
 */
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { arr, isObject, num, parseJson, str } from '../../lib/json'
import { readText, writeAtomic } from '../persistence/jsonl'
import { isServeCommand, terminate } from './process-table'
import type { ServePidRecord, ServeTracker } from './process.types'

export const SERVE_PIDS_FILE = 'serve-pids.json'
const ORPHAN_GRACE_MS = 3000

/** Прочитать записи serve-pids.json (битый/отсутствующий файл — пусто). */
export function readServePids(file: string): ServePidRecord[] {
	const out: ServePidRecord[] = []
	for (const v of arr(parseJson(readText(file)))) {
		if (!isObject(v)) continue
		const pid = num(v['pid'])
		if (!Number.isInteger(pid) || pid <= 0) continue
		out.push({ pid, port: num(v['port']), workspace: str(v['workspace']), startedAt: str(v['startedAt']) })
	}
	return out
}

export class ServeProcesses implements ServeTracker {
	private readonly live = new Map<number, { proc: ChildProcess; rec: ServePidRecord }>()

	constructor(
		readonly file: string,
		private readonly log: (line: string) => void = line => console.log(line),
	) {}

	track(proc: ChildProcess, info: { port: number; workspace: string }): void {
		const pid = proc.pid
		if (!pid) return // spawn не удался — процесса нет
		const rec: ServePidRecord = { pid, port: info.port, workspace: info.workspace, startedAt: new Date().toISOString() }
		this.live.set(pid, { proc, rec })
		this.update(list => [...list.filter(r => r.pid !== pid), rec])
		proc.once('exit', () => {
			this.live.delete(pid)
			this.update(list => list.filter(r => r.pid !== pid))
		})
	}

	/** Синхронно послать SIGTERM всем живым serve (для process.on('exit')). */
	killAllSync(): void {
		for (const { proc } of this.live.values()) {
			if (proc.exitCode !== null || proc.signalCode !== null) continue
			try {
				proc.kill('SIGTERM')
			} catch {
				/* процесс уже вышел */
			}
		}
	}

	/**
	 * Остановить serve, оставшиеся от прошлых запусков: pid из файла, который жив и чья командная строка —
	 * `… serve … --workspace …`. Чужие pid (командная строка не совпала) не трогаются. Свои живые — тоже.
	 * После — в файле остаются только свои живые записи.
	 */
	async cleanupOrphans(): Promise<ServePidRecord[]> {
		const stale = readServePids(this.file).filter(r => !this.live.has(r.pid))
		const killed: ServePidRecord[] = []
		for (const r of stale) {
			if (await terminate(r.pid, isServeCommand, ORPHAN_GRACE_MS)) {
				killed.push(r)
				this.log(`[nessy-orch] остановлен осиротевший nessy serve pid=${r.pid} port=${r.port}`)
			}
		}
		const gone = new Set(stale.map(r => r.pid))
		this.update(list => list.filter(r => !gone.has(r.pid)))
		return killed
	}

	private update(fn: (list: ServePidRecord[]) => ServePidRecord[]): void {
		try {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			const next = fn(readServePids(this.file))
			writeAtomic(this.file, JSON.stringify(next, null, 2) + '\n')
		} catch {
			/* учёт pid — вспомогательный, ошибка записи не должна ронять запуск serve */
		}
	}
}
