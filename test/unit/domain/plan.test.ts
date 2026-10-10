import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentPlan, PlanEntry } from '../../../shared/types'
import { AppError } from '../../../src/domain/errors'
import {
	coercePlanEntries,
	formatPlanLine,
	isPlanDone,
	parsePlanArgs,
	parsePlanLine,
	planOnTurnStart,
	validatePlanEntries,
} from '../../../src/domain/plan'
import { plainText } from '../../../src/lib/text'

const isBadPlan = (e: unknown): boolean => e instanceof AppError && e.status === 400 && e.code === 'bad_plan'
const plan = (...statuses: PlanEntry['status'][]): AgentPlan => ({
	entries: statuses.map((status, i) => ({ content: `шаг ${i + 1}`, status })),
	updatedAt: '2026-01-01T00:00:00.000Z',
	source: 'cli',
})

describe('план: разбор чек-листа', () => {
	it('отметки [x] / [~] / [>] / [ ] и простой текст', () => {
		assert.deepEqual(parsePlanLine('- [x] шаг 1'), { content: 'шаг 1', status: 'completed' })
		assert.deepEqual(parsePlanLine('- [X] шаг'), { content: 'шаг', status: 'completed' })
		assert.deepEqual(parsePlanLine('- [~] шаг 2'), { content: 'шаг 2', status: 'in_progress' })
		assert.deepEqual(parsePlanLine('* [>] шаг'), { content: 'шаг', status: 'in_progress' })
		assert.deepEqual(parsePlanLine('- [ ] шаг 3'), { content: 'шаг 3', status: 'pending' })
		assert.deepEqual(parsePlanLine('[x] без маркера'), { content: 'без маркера', status: 'completed' })
		assert.deepEqual(parsePlanLine('  просто текст  '), { content: 'просто текст', status: 'pending' })
		assert.deepEqual(parsePlanLine('- пункт списка'), { content: 'пункт списка', status: 'pending' })
	})
	it('каждый аргумент — запись; многострочный аргумент — по записи на строку', () => {
		assert.deepEqual(parsePlanArgs(['- [x] a', '- [~] b\n\n- [ ] c']), [
			{ content: 'a', status: 'completed' },
			{ content: 'b', status: 'in_progress' },
			{ content: 'c', status: 'pending' },
		])
	})
	it('пустой план и пустой пункт — 400 bad_plan', () => {
		assert.throws(() => parsePlanArgs([]), isBadPlan)
		assert.throws(() => parsePlanArgs(['- [x] ']), isBadPlan)
	})
	it('formatPlanLine — обратно в чек-лист', () => {
		assert.deepEqual(
			plan('completed', 'in_progress', 'pending').entries.map(formatPlanLine),
			['[x] шаг 1', '[~] шаг 2', '[ ] шаг 3'],
		)
	})
})

describe('план: проверка записей', () => {
	it('trim содержимого, допустимые статусы', () => {
		assert.deepEqual(validatePlanEntries([{ content: '  a  ', status: 'pending' }]), [{ content: 'a', status: 'pending' }])
	})
	it('от 1 до 30 записей', () => {
		assert.throws(() => validatePlanEntries([]), isBadPlan)
		const many = Array.from({ length: 31 }, () => ({ content: 'x', status: 'pending' }))
		assert.throws(() => validatePlanEntries(many), isBadPlan)
		assert.equal(validatePlanEntries(many.slice(0, 30)).length, 30)
	})
	it('content 1..300 символов, статус из трёх, запись — объект', () => {
		assert.throws(() => validatePlanEntries([{ content: '   ', status: 'pending' }]), isBadPlan)
		assert.throws(() => validatePlanEntries([{ content: 'x'.repeat(301), status: 'pending' }]), isBadPlan)
		assert.equal(validatePlanEntries([{ content: 'x'.repeat(300), status: 'pending' }])[0]?.content.length, 300)
		assert.throws(() => validatePlanEntries([{ content: 'a', status: 'failed' }]), isBadPlan)
		assert.throws(() => validatePlanEntries([{ content: 1, status: 'pending' }]), isBadPlan)
		assert.throws(() => validatePlanEntries(['a']), isBadPlan)
		assert.throws(() => validatePlanEntries('a'), isBadPlan)
	})
	it('мягкая нормализация (ACP): пустые отброшены, длинные усечены, не больше 30', () => {
		const out = coercePlanEntries([
			{ content: ' ', status: 'pending' },
			{ content: 'y'.repeat(400), status: 'completed' },
			...Array.from({ length: 40 }, () => ({ content: 'z', status: 'pending' as const })),
		])
		assert.equal(out.length, 30)
		assert.equal(out[0]?.content.length, 300)
	})
})

describe('план: правило сброса в начале хода', () => {
	it('новая сессия от оператора после выполненного плана — сброс', () => {
		assert.equal(planOnTurnStart(plan('completed', 'completed'), true, 0), null)
	})
	it('план не доделан, есть очередь, сообщение от агента или плана нет — сохраняется', () => {
		const open = plan('completed', 'in_progress')
		assert.equal(planOnTurnStart(open, true, 0), open)
		const done = plan('completed')
		assert.equal(planOnTurnStart(done, true, 1), done)
		assert.equal(planOnTurnStart(done, false, 0), done)
		assert.equal(planOnTurnStart(null, true, 0), null)
		assert.equal(isPlanDone(null), false)
	})
})

describe('plainText', () => {
	it('убирает markdown и схлопывает пробелы', () => {
		assert.equal(plainText('## Итог\n\n- **жирный** `код`\n> цитата [ссылка](http://x)'), 'Итог жирный код цитата ссылка')
	})
})
