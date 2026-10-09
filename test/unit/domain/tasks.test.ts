import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTaskId, taskIdFrom, taskSlugBase, validateTaskPatch, validateTaskRequest } from '../../../src/domain/tasks'

describe('domain/tasks', () => {
	it('slug из заголовка: транслитерация, дефисы, обрезка, fallback task', () => {
		assert.equal(taskSlugBase('Починить CI в shippy'), 'pochinit-ci-v-shippy')
		assert.equal(taskSlugBase('  Fix: flaky tests!!  '), 'fix-flaky-tests')
		assert.equal(taskSlugBase('🚀🚀'), 'task')
		assert.ok(taskSlugBase('а'.repeat(100)).length <= 40)
		assert.equal(taskIdFrom('Обзор MR', '3f2a'), 'obzor-mr-3f2a')
		assert.equal(taskIdFrom('???', '00ff'), 'task-00ff')
	})
	it('isTaskId', () => {
		assert.equal(isTaskId('fix-ci-3f2a'), true)
		assert.equal(isTaskId('-bad'), false)
		assert.equal(isTaskId('Bad'), false)
		assert.equal(isTaskId('a'.repeat(49)), false)
	})
	it('validateTaskRequest: заголовок обязателен, пробелы схлопываются, id проверяется', () => {
		assert.deepEqual(validateTaskRequest({ title: '  два   слова ', owner: ' claude ' }), { id: null, title: 'два слова', owner: 'claude' })
		assert.deepEqual(validateTaskRequest({ title: 'x', owner: '  ', id: 'my-task' }), { id: 'my-task', title: 'x', owner: null })
		assert.throws(() => validateTaskRequest({ title: '   ' }), /title обязателен/)
		assert.throws(() => validateTaskRequest({ title: 'x', id: 'Плохой id' }), /id/)
		assert.throws(() => validateTaskRequest({ title: 'x'.repeat(201) }), /длиннее/)
	})
	it('validateTaskPatch: только переданные поля, пустой summary → null, неверный статус → 400', () => {
		assert.deepEqual(validateTaskPatch({}), {})
		assert.deepEqual(validateTaskPatch({ status: 'done', summary: '  итог ' }), { status: 'done', summary: 'итог' })
		assert.deepEqual(validateTaskPatch({ summary: '  ' }), { summary: null })
		assert.deepEqual(validateTaskPatch({ summary: null, title: ' новое ' }), { summary: null, title: 'новое' })
		// статус приходит из JSON — проверяется и в рантайме
		const raw: unknown = JSON.parse('{"status":"closed"}')
		assert.throws(() => validateTaskPatch(raw as Parameters<typeof validateTaskPatch>[0]), /status/)
	})
})
