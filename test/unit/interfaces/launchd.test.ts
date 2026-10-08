import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { loginShell, programArguments } from '../../../src/interfaces/cli/launchd'

describe('launchd: запуск через login shell', () => {
	it('команда — shell -lic exec node main.js; кавычки в путях экранируются', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "it's-"))
		const main = path.join(dir, 'main.js')
		fs.writeFileSync(main, 'console.log("запущен")')
		const args = programArguments('/bin/sh', process.execPath, main)
		assert.deepEqual(args.slice(0, 2), ['/bin/sh', '-lic'])
		const r = spawnSync(args[0] ?? '', args.slice(1), { encoding: 'utf8' })
		assert.equal(r.stdout.trim(), 'запущен')
	})

	it('shell берётся из SHELL, иначе /bin/zsh', () => {
		assert.equal(loginShell({ SHELL: '/bin/sh' }), '/bin/sh')
		assert.equal(loginShell({ SHELL: 'relative' }), '/bin/zsh')
		assert.equal(loginShell({}), '/bin/zsh')
	})
})
