/** Модели агентов: формат строки и сравнение запрошенной модели с фактической. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import { modelMatches, normalizeModel, validateModel } from '../../../src/domain/models'

describe('модели: домен', () => {
	it('validateModel: пусто → null, строка без пробелов принимается, мусор — 400', () => {
		assert.equal(validateModel(undefined), null)
		assert.equal(validateModel(null), null)
		assert.equal(validateModel('  '), null)
		assert.equal(validateModel(' opus '), 'opus')
		assert.equal(validateModel('claude-opus-4-5-20251101'), 'claude-opus-4-5-20251101')
		assert.equal(validateModel('opus[1m]'), 'opus[1m]')
		for (const bad of ['a b', '-x', 'x'.repeat(101), 'a;b']) {
			assert.throws(
				() => validateModel(bad),
				(e: unknown) => e instanceof AppError && e.status === 400 && e.code === 'bad_request',
				bad,
			)
		}
	})
	it('modelMatches: псевдоним совпадает с полным id, чужая модель и «не подтверждена» — нет', () => {
		assert.equal(normalizeModel('opus'), 'claude-opus')
		assert.equal(modelMatches('opus', 'claude-opus-4-5'), true)
		assert.equal(modelMatches('claude-opus-4-5', 'claude-opus-4-5'), true)
		assert.equal(modelMatches('sonnet', 'claude-opus-4-5'), false)
		assert.equal(modelMatches('opus', 'zai/glm-4.6'), false)
		assert.equal(modelMatches('opus', null), false)
		assert.equal(modelMatches('opus', ''), false)
	})
})
