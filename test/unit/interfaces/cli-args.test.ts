import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flagBool, flagNum, flagStr, parseArgs } from '../../../src/interfaces/cli/args'
import { endpoint } from '../../../src/interfaces/cli/client'
import { CliError } from '../../../src/interfaces/cli/errors'

describe('CLI parseArgs', () => {
	const spec = { bool: ['wait', 'json'], value: ['space', 'timeout'], short: { w: 'wait' } }
	it('флаги и позиционные вперемешку', () => {
		const p = parseArgs(['--space', '/x', 'текст', '-w', '--timeout=5', 'ещё'], spec)
		assert.deepEqual(p.positionals, ['текст', 'ещё'])
		assert.equal(flagBool(p, 'wait'), true)
		assert.equal(flagStr(p, 'space'), '/x')
		assert.equal(flagNum(p, 'timeout'), 5)
		assert.equal(flagNum(p, 'nope'), undefined)
	})
	it('`--` отделяет текст, начинающийся с дефиса; `-` — позиционный', () => {
		const p = parseArgs(['--wait', '--', '--не-флаг', '-'], spec)
		assert.deepEqual(p.positionals, ['--не-флаг', '-'])
	})
	it('--flag=false для булевых', () => {
		assert.equal(flagBool(parseArgs(['--json=false'], spec), 'json'), false)
	})
	it('ошибки: неизвестный флаг, нет значения, не число — код выхода 2', () => {
		const exit = (fn: () => unknown): number => {
			try {
				fn()
			} catch (e) {
				return e instanceof CliError ? e.exitCode : -1
			}
			return 0
		}
		assert.throws(() => parseArgs(['--nope'], spec), /неизвестный флаг/)
		assert.equal(exit(() => parseArgs(['--nope'], spec)), 2)
		assert.equal(exit(() => parseArgs(['--space'], spec)), 2)
		assert.equal(exit(() => flagNum(parseArgs(['--timeout', 'abc'], spec), 'timeout')), 2)
	})
	it('endpoint из ORCH_PORT', () => {
		assert.deepEqual(endpoint({ ORCH_PORT: '5000' }), { host: '127.0.0.1', port: 5000 })
		assert.deepEqual(endpoint({}), { host: '127.0.0.1', port: 4337 })
	})
})
