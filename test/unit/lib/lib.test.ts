import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sleep } from '../../../src/lib/async'
import { rid } from '../../../src/lib/ids'
import { arr, bool, errMsg, isObject, num, obj, parseJson, str, strOrNull } from '../../../src/lib/json'
import { clip } from '../../../src/lib/text'

describe('lib/json', () => {
	it('isObject/obj/arr отличают объекты, массивы и null', () => {
		assert.equal(isObject({}), true)
		assert.equal(isObject([]), false)
		assert.equal(isObject(null), false)
		assert.deepEqual(obj('x'), {})
		assert.deepEqual(obj({ a: 1 }), { a: 1 })
		assert.deepEqual(arr({}), [])
		assert.deepEqual(arr([1]), [1])
	})
	it('str/strOrNull/num/bool со значениями по умолчанию', () => {
		assert.equal(str(1), '')
		assert.equal(str(1, 'd'), 'd')
		assert.equal(str('a'), 'a')
		assert.equal(strOrNull(''), null)
		assert.equal(strOrNull('x'), 'x')
		assert.equal(num(NaN, 5), 5)
		assert.equal(num(Infinity), 0)
		assert.equal(num(3), 3)
		assert.equal(bool('true'), false)
		assert.equal(bool(true), true)
	})
	it('parseJson не бросает исключений', () => {
		assert.equal(parseJson('{'), undefined)
		assert.deepEqual(parseJson('{"a":[1]}'), { a: [1] })
	})
	it('errMsg', () => {
		assert.equal(errMsg(new Error('boom')), 'boom')
		assert.equal(errMsg('строка'), 'строка')
	})
})

describe('lib/text, ids, async', () => {
	it('clip усекает с многоточием и сериализует не-строки', () => {
		assert.equal(clip('abcdef', 4), 'abc…')
		assert.equal(clip('abc', 4), 'abc')
		assert.equal(clip(null), '')
		assert.equal(clip({ a: 1 }), '{"a":1}')
	})
	it('rid даёт id нужной длины из безопасного алфавита', () => {
		const ids = new Set(Array.from({ length: 200 }, () => rid(6)))
		for (const id of ids) assert.match(id, /^[a-hj-km-np-z2-9]{6}$/)
		assert.ok(ids.size > 190)
	})
	it('sleep ждёт', async () => {
		const t0 = Date.now()
		await sleep(30)
		assert.ok(Date.now() - t0 >= 25)
	})
})
