import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

/** Корень репозитория: вверх от теста (из dist/) или от cwd (при нестандартном outDir). */
function repoRoot(): string {
	for (const start of [__dirname, process.cwd()]) {
		let dir = start
		for (;;) {
			if (existsSync(join(dir, 'THIRD_PARTY_NOTICES.md'))) return dir
			const up = dirname(dir)
			if (up === dir) break
			dir = up
		}
	}
	throw new Error('корень репозитория не найден')
}

describe('THIRD_PARTY_NOTICES', () => {
	it('полный текст Apache-2.0 лежит в LICENSES и указан в уведомлениях', () => {
		const root = repoRoot()
		const text = readFileSync(join(root, 'LICENSES', 'Apache-2.0.txt'), 'utf8')
		assert.match(text, /Apache License\s+Version 2\.0, January 2004/)
		assert.match(text, /END OF TERMS AND CONDITIONS/)
		assert.match(readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /LICENSES\/Apache-2\.0\.txt/)
	})
})
