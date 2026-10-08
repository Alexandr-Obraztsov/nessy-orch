/**
 * Защита от второго экземпляра: <home>/orch.lock с pid работающего оркестратора.
 * Второй экземпляр (например, ручной запуск рядом с launchd) не должен ничего делать с состоянием.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readText } from '../persistence/jsonl'
import { aliveMatching, isOrchCommand } from './process-table'
import type { LockResult } from './process.types'

export const LOCK_FILE = 'orch.lock'

/** pid из lock-файла или null. */
export function readLockPid(file: string): number | null {
	const pid = parseInt(readText(file).trim(), 10)
	return Number.isInteger(pid) && pid > 0 ? pid : null
}

/**
 * Захватить lock: если в нём живой pid другого оркестратора (`…dist/src/main.js`) — отказ, файл не трогаем.
 * Иначе (нет файла, мёртвый или чужой pid) — записываем свой pid. release() удаляет файл, если он наш.
 */
export function acquireLock(home: string, pid: number = process.pid): LockResult {
	const file = path.join(home, LOCK_FILE)
	const holder = readLockPid(file)
	if (holder !== null && holder !== pid && aliveMatching(holder, isOrchCommand)) return { ok: false, pid: holder }
	fs.mkdirSync(home, { recursive: true })
	fs.writeFileSync(file, String(pid) + '\n')
	let released = false
	return {
		ok: true,
		release: () => {
			if (released) return
			released = true
			try {
				if (readLockPid(file) === pid) fs.unlinkSync(file)
			} catch {
				/* файл уже удалён */
			}
		},
	}
}
