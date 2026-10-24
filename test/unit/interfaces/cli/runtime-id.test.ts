import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseRuntimeId } from '../../../../src/interfaces/cli/runtime-id'
import { RUNTIME_IDS, isRuntimeId } from '../../../../src/domain/constants'
import { CliError } from '../../../../src/interfaces/cli/errors'

describe('CLI RuntimeId', () => {
	it('известные рантаймы', () => {
		assert.deepEqual(RUNTIME_IDS, ['nessy-sdk', 'tclaude'])
		assert.equal(isRuntimeId('nessy-sdk'), true)
		assert.equal(isRuntimeId('tclaude'), true)
		assert.equal(isRuntimeId('nope'), false)
		assert.equal(isRuntimeId(42), false)
	})
	it('parseRuntimeId: undefined → undefined, валидный → значение', () => {
		assert.equal(parseRuntimeId(undefined), undefined)
		assert.equal(parseRuntimeId('tclaude'), 'tclaude')
	})
	it('parseRuntimeId: неизвестный — CliError с кодом 2', () => {
		try {
			parseRuntimeId('nope')
			assert.fail('должен был бросить CliError')
		} catch (e) {
			assert.ok(e instanceof CliError)
			assert.equal(e.exitCode, 2)
			assert.match(e.message, /неизвестный рантайм/)
		}
	})
})
