import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSessionId, sessionIdFrom, sessionSlugBase, validateSessionPatch, validateSessionRequest } from '../../../src/domain/sessions'

describe('domain/sessions', () => {
	it('slug из заголовка: транслитерация, дефисы, обрезка, fallback session', () => {
		assert.equal(sessionSlugBase('Починить CI в shippy'), 'pochinit-ci-v-shippy')
		assert.equal(sessionSlugBase('  Fix: flaky tests!!  '), 'fix-flaky-tests')
		assert.equal(sessionSlugBase('🚀🚀'), 'session')
		assert.ok(sessionSlugBase('а'.repeat(100)).length <= 40)
		assert.equal(sessionIdFrom('Обзор MR', '3f2a'), 'obzor-mr-3f2a')
		assert.equal(sessionIdFrom('???', '00ff'), 'session-00ff')
	})
	it('isSessionId', () => {
		assert.equal(isSessionId('fix-ci-3f2a'), true)
		assert.equal(isSessionId('-bad'), false)
		assert.equal(isSessionId('Bad'), false)
		assert.equal(isSessionId('a'.repeat(49)), false)
	})
	it('validateSessionRequest: заголовок обязателен, пробелы схлопываются, id проверяется', () => {
		assert.deepEqual(validateSessionRequest({ title: '  два   слова ', owner: ' claude ' }), { id: null, title: 'два слова', owner: 'claude' })
		assert.deepEqual(validateSessionRequest({ title: 'x', owner: '  ', id: 'my-session' }), { id: 'my-session', title: 'x', owner: null })
		assert.throws(() => validateSessionRequest({ title: '   ' }), /title обязателен/)
		assert.throws(() => validateSessionRequest({ title: 'x', id: 'Плохой id' }), /id/)
		assert.throws(() => validateSessionRequest({ title: 'x'.repeat(201) }), /длиннее/)
	})
	it('validateSessionPatch: только переданные поля, пустой summary → null, неверный статус → 400', () => {
		assert.deepEqual(validateSessionPatch({}), {})
		assert.deepEqual(validateSessionPatch({ status: 'done', summary: '  итог ' }), { status: 'done', summary: 'итог' })
		assert.deepEqual(validateSessionPatch({ summary: '  ' }), { summary: null })
		assert.deepEqual(validateSessionPatch({ summary: null, title: ' новое ' }), { summary: null, title: 'новое' })
		// статус приходит из JSON — проверяется и в рантайме
		const raw: unknown = JSON.parse('{"status":"closed"}')
		assert.throws(() => validateSessionPatch(raw as Parameters<typeof validateSessionPatch>[0]), /status/)
	})
})
