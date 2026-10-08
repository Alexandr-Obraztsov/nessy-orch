import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { loadEnvFiles, parseEnvFile } from '../../../src/infrastructure/config/env-file'

describe('.env', () => {
	it('разбирает KEY=value, export, кавычки, комментарии', () => {
		const env = parseEnvFile(
			[
				'# комментарий',
				'NESSY_SERVER_TOKEN=abc123',
				'export A="x y"',
				"B='z # не комментарий'",
				'C=val # комментарий',
				'EMPTY=',
				'плохая строка',
				'D="a\\nb"',
			].join('\r\n'),
		)
		assert.deepEqual(env, { NESSY_SERVER_TOKEN: 'abc123', A: 'x y', B: 'z # не комментарий', C: 'val', EMPTY: '', D: 'a\nb' })
	})

	it('загружает файлы по порядку и не перезаписывает заданное', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envf-'))
		const a = path.join(dir, 'a.env')
		const b = path.join(dir, 'b.env')
		fs.writeFileSync(a, 'T=from-a\nX=1')
		fs.writeFileSync(b, 'T=from-b\nY=2')
		const env: NodeJS.ProcessEnv = { X: 'preset' }
		const loaded = loadEnvFiles([a, b, path.join(dir, 'missing.env')], env)
		assert.deepEqual(loaded, [a, b])
		assert.equal(env['T'], 'from-a')
		assert.equal(env['X'], 'preset')
		assert.equal(env['Y'], '2')
	})
})
