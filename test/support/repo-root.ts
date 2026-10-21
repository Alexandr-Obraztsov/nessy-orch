import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Корень репозитория: вверх от теста (из dist/) или от cwd (при нестандартном outDir, например /tmp/…/test).
 * Признак корня — `learning/prompts`: промпты агентов лежат только в репозитории, а не в outDir.
 */
export function repoRoot(): string {
	for (const start of [__dirname, process.cwd()]) {
		let dir = start
		for (;;) {
			if (existsSync(join(dir, 'learning', 'prompts', 'session-collector.md'))) return dir
			const up = dirname(dir)
			if (up === dir) break
			dir = up
		}
	}
	throw new Error('корень репозитория не найден')
}
