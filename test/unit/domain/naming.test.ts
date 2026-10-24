import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { slugify } from '../../../src/domain/naming'

describe('slugify', () => {
	it('кириллица транслитерируется, знаки схлопываются в дефис', () => {
		assert.equal(slugify('Релиз пакета №2!', 'c-1'), 'reliz-paketa-2')
		assert.equal(slugify('Fix  MR /a_b', 'c-1'), 'fix-mr-a-b')
	})
	it('пусто после очистки — запасное значение; длина до 40', () => {
		assert.equal(slugify('— ъь —', 'c-1'), 'c-1')
		assert.ok(slugify('a'.repeat(100), 'x').length <= 40)
	})
})
