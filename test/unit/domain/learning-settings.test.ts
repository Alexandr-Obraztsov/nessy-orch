import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import { DEFAULT_LEARNING, parseLearningSettings, patchLearningSettings } from '../../../src/domain/learning-settings'

describe('parseLearningSettings', () => {
	it('нет файла — умолчания', () => {
		assert.deepEqual(parseLearningSettings(undefined), DEFAULT_LEARNING)
		assert.deepEqual(DEFAULT_LEARNING, {
			enabled: true,
			autoReview: true,
			intervalMin: 10,
			idleMin: 120,
			maxAgents: 2,
			retrySec: 60,
			stallMin: 20,
			blockEvents: 80,
			blockChars: 40_000,
			archiveDays: 30,
			disabledSessions: [],
		})
	})
	it('битые поля заменяются поштучно', () => {
		const s = parseLearningSettings({ intervalMin: 'x', idleMin: 5 })
		assert.equal(s.intervalMin, 10)
		assert.equal(s.idleMin, 5)
	})
	it('числа ограничиваются ближайшей границей', () => {
		const s = parseLearningSettings({ intervalMin: 0, idleMin: 99999, maxAgents: 50 })
		assert.deepEqual([s.intervalMin, s.idleMin, s.maxAgents], [1, 10_080, 6])
		const t = parseLearningSettings({ intervalMin: 500, idleMin: 1, maxAgents: 0 })
		assert.deepEqual([t.intervalMin, t.idleMin, t.maxAgents], [120, 5, 1])
	})
	it('новые поля: границы и умолчания', () => {
		const lo = parseLearningSettings({ retrySec: 1, stallMin: -5, blockEvents: 1, blockChars: 10, archiveDays: -1 })
		assert.deepEqual([lo.retrySec, lo.stallMin, lo.blockEvents, lo.blockChars, lo.archiveDays], [5, 0, 10, 4000, 0])
		const hi = parseLearningSettings({ retrySec: 99999, stallMin: 9999, blockEvents: 9999, blockChars: 9e9, archiveDays: 9999 })
		assert.deepEqual([hi.retrySec, hi.stallMin, hi.blockEvents, hi.blockChars, hi.archiveDays], [3600, 720, 400, 200_000, 365])
		const bad = parseLearningSettings({ retrySec: 'x', stallMin: null })
		assert.deepEqual([bad.retrySec, bad.stallMin], [60, 20])
		assert.equal(parseLearningSettings({ stallMin: 0 }).stallMin, 0) // 0 — сторож выключен
	})
	it('patch: новые поля меняются и ограничиваются; неверный тип — 400', () => {
		const s = patchLearningSettings(DEFAULT_LEARNING, { retrySec: 30, stallMin: 0, blockEvents: 5, archiveDays: 400 })
		assert.deepEqual([s.retrySec, s.stallMin, s.blockEvents, s.archiveDays], [30, 0, 10, 365])
		assert.throws(() => patchLearningSettings(DEFAULT_LEARNING, { stallMin: '5' }), { status: 400, code: 'bad_request' })
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
