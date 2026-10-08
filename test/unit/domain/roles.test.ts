import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import { isRoleId, roleColor, roleSlug, transliterate, validateRole } from '../../../src/domain/roles'

const code = (fn: () => unknown): string => {
	try {
		fn()
	} catch (e) {
		return e instanceof AppError ? `${e.status}:${e.code}` : 'other'
	}
	return 'ok'
}

describe('роли: домен', () => {
	it('транслитерация и slug', () => {
		assert.equal(transliterate('Щука и Ёж'), 'schuka i ezh')
		assert.equal(roleSlug('Ревьюер кода'), 'revyuer-koda')
		assert.equal(roleSlug('  QA / Тестировщик 1 '), 'qa-testirovschik-1')
		assert.equal(roleSlug('Café'), 'cafe')
		assert.equal(roleSlug('!!!'), 'role')
		assert.equal(roleSlug('а'.repeat(50)).length, 40)
		assert.equal(roleSlug('ab '.repeat(30)).endsWith('-'), false)
	})
	it('id и цвет', () => {
		assert.equal(isRoleId('reviewer-2'), true)
		assert.equal(isRoleId('-x'), false)
		assert.equal(isRoleId('X'), false)
		assert.equal(isRoleId('a'.repeat(41)), false)
		assert.equal(roleColor('Reviewer'), roleColor('reviewer'))
		assert.ok(roleColor('Аналитик') >= 0 && roleColor('Аналитик') < 360)
	})
	it('validateRole: значения по умолчанию и ошибки', () => {
		assert.deepEqual(validateRole({ name: ' Аналитик ', instructions: ' считай \n', description: 'много\nстрок' }), {
			id: 'analitik',
			name: 'Аналитик',
			description: 'много строк',
			instructions: 'считай',
			color: roleColor('Аналитик'),
		})
		assert.equal(validateRole({ name: 'R', instructions: 'i', id: 'custom', color: 359.6 }).color, 360)
		assert.equal(code(() => validateRole({ name: '', instructions: 'i' })), '400:bad_request')
		assert.equal(code(() => validateRole({ name: 'r', instructions: ' ' })), '400:bad_request')
		assert.equal(code(() => validateRole({ name: 'r'.repeat(61), instructions: 'i' })), '400:bad_request')
		assert.equal(code(() => validateRole({ name: 'r', instructions: 'i'.repeat(20001) })), '400:bad_request')
		assert.equal(code(() => validateRole({ name: 'r', instructions: 'i', id: 'Плохой' })), '400:bad_request')
		assert.equal(code(() => validateRole({ name: 'r', instructions: 'i', color: -1 })), '400:bad_request')
		assert.equal(code(() => validateRole({ name: 'r', instructions: 'i', color: Number.NaN })), '400:bad_request')
	})
})
