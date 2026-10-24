import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeRanges, parseAnchor } from '../../../src/domain/anchors'

describe('parseAnchor', () => {
	it('три формы', () => {
		assert.deepEqual(parseAnchor('n 12–15'), { from: 12, to: 15 })
		assert.deepEqual(parseAnchor('n 12-15'), { from: 12, to: 15 })
		assert.deepEqual(parseAnchor('n 12'), { from: 12, to: 12 })
	})
	it('мусор — null', () => {
		for (const a of ['', 'abc', 'n', 'n x', 'n 15-12', '12-15', 'n 1-2-3']) assert.equal(parseAnchor(a), null, a)
	})
})

describe('mergeRanges', () => {
	it('с отступом диапазоны сливаются', () => {
		assert.deepEqual(
			mergeRanges(
				[
					{ from: 1, to: 3 },
					{ from: 5, to: 9 },
				],
				2,
			),
			[{ from: 1, to: 11 }],
		)
	})
	it('нижняя граница не меньше 1, далёкие остаются раздельно, порядок восстановлен', () => {
		assert.deepEqual(
			mergeRanges(
				[
					{ from: 50, to: 52 },
					{ from: 2, to: 3 },
				],
				5,
			),
			[
				{ from: 1, to: 8 },
				{ from: 45, to: 57 },
			],
		)
	})
	it('пусто', () => {
		assert.deepEqual(mergeRanges([], 3), [])
	})
})
