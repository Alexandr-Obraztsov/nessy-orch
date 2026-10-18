import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import { DEFAULT_LEARNING, parseLearningSettings, patchLearningSettings } from '../../../src/domain/learning-settings'

describe('parseLearningSettings', () => {
	it('нет файла — умолчания', () => {
		assert.deepEqual(parseLearningSettings(undefined), DEFAULT_LEARNING)
		assert.deepEqual(DEFAULT_LEARNING, { enabled: true, autoReview: true, intervalMin: 10, idleMin: 30, maxAgents: 2, disabledSessions: [] })
	})
	it('битые поля заменяются поштучно', () => {
		const s = parseLearningSettings({ intervalMin: 'x', idleMin: 5 })
		assert.equal(s.intervalMin, 10)
		assert.equal(s.idleMin, 5)
	})
	it('числа ограничиваются ближайшей границей', () => {
		const s = parseLearningSettings({ intervalMin: 0, idleMin: 99999, maxAgents: 50 })
		assert.deepEqual([s.intervalMin, s.idleMin, s.maxAgents], [1, 1440, 6])
		const t = parseLearningSettings({ intervalMin: 500, idleMin: 1, maxAgents: 0 })
		assert.deepEqual([t.intervalMin, t.idleMin, t.maxAgents], [120, 5, 1])
	})
	it('disabledSessions — только строки без дублей', () => {
		assert.deepEqual(parseLearningSettings({ disabledSessions: ['a', 1, 'a', 'b', null] }).disabledSessions, ['a', 'b'])
	})
})

describe('patchLearningSettings', () => {
	it('применяет правку и ограничивает', () => {
		const s = patchLearningSettings(DEFAULT_LEARNING, { enabled: false, maxAgents: 9 })
		assert.equal(s.enabled, false)
		assert.equal(s.maxAgents, 6)
		assert.equal(s.intervalMin, 10)
	})
	it('неверный тип — 400 bad_request', () => {
		for (const patch of [{ enabled: 'yes' }, { intervalMin: '5' }, { disabledSessions: [1] }, 'x']) {
			assert.throws(
				() => patchLearningSettings(DEFAULT_LEARNING, patch),
				(e: unknown) => e instanceof AppError && e.status === 400 && e.code === 'bad_request',
			)
		}
	})
})
