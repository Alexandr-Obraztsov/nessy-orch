import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import { test } from 'node:test'

const MAIN = path.join(__dirname, '../../../../src/interfaces/cli-v2/main.js')

test('main.js --help — справка в stdout, код 0', () => {
	const r = spawnSync(process.execPath, [MAIN, '--help'], { encoding: 'utf8' })
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stdout, /nessy-orch-v2/)
})

test('main.js неизвестная команда — код 2 и ошибка в stderr', () => {
	const r = spawnSync(process.execPath, [MAIN, 'definitely-not-a-command'], { encoding: 'utf8' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /неизвестная команда/)
})
