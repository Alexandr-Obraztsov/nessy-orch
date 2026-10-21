/** Разбор тел правки блоками: baseVersion, removeRules, слаги этапов, `base` описания. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePlaybookPatch, parseSummaryPut } from '../../../src/interfaces/http/parsers'

const stage = (title: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ title, role: null, where: 'w', produce: 'p', done: 'd', gate: false, template: 't', ...extra })

describe('parsePlaybookPatch', () => {
	it('baseVersion обязателен (целое от 1), одного его мало', () => {
		assert.throws(() => parsePlaybookPatch({ title: 'x' }), { code: 'bad_request' })
		assert.throws(() => parsePlaybookPatch({ baseVersion: 0, title: 'x' }), { code: 'bad_request' })
		assert.throws(() => parsePlaybookPatch({ baseVersion: 1 }), { code: 'bad_request' })
		assert.deepEqual(parsePlaybookPatch({ baseVersion: 2, title: 'x', removeRules: ['r1'] }), { baseVersion: 2, title: 'x', removeRules: ['r1'] })
		assert.deepEqual(parsePlaybookPatch({ baseVersion: 2, removeRules: ['r1'] }), { baseVersion: 2, removeRules: ['r1'] })
		assert.throws(() => parsePlaybookPatch({ baseVersion: 2, removeRules: [1] }), { code: 'bad_request' })
	})

	it('слаг этапа: кириллица транслитерируется, без латиницы — stage-<n>, повторы уникальны', () => {
		const p = parsePlaybookPatch({ baseVersion: 1, stages: [stage('Прочитать дифф'), stage('Написать комментарии'), stage('!!!'), stage('Read the diff'), stage('Read the diff'), stage('x', { slug: 'custom' })] })
		const st = p.stages
		assert.ok(st)
		assert.deepEqual(st.map(s => s.slug), ['prochitat-diff', 'napisat-kommentarii', 'stage-3', 'read-the-diff', 'read-the-diff-2', 'custom'])
		assert.deepEqual(st.map(s => s.n), [0, 0, 0, 0, 0, 0])
	})
})

describe('parseSummaryPut', () => {
	it('нужны text и base (sha1 hex)', () => {
		const base = 'a'.repeat(40)
		assert.deepEqual(parseSummaryPut({ text: '', base }), { text: '', base })
		assert.throws(() => parseSummaryPut({ text: 'x' }), { code: 'bad_request' })
		assert.throws(() => parseSummaryPut({ text: 'x', base: 'zz' }), { code: 'bad_request' })
		assert.throws(() => parseSummaryPut({ base }), { code: 'bad_request' })
	})
})
