import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildIndex, caseDigest, search, similarity, tokenize } from '../../../src/domain/learning-search'

describe('tokenize', () => {
	it('нижний регистр, без стоп-слов и коротких слов', () => {
		assert.deepEqual(tokenize('The AFF пакет: реализовать и это для 42 go'), ['aff', 'пакет', 'реализовать'])
	})
})

describe('search', () => {
	const docs = [
		{ id: 'a', text: 'Implement aff package: реализовать пакет aff в репозитории, добавить тесты' },
		{ id: 'b', text: 'Review merge request in GitLab and comment on the diff' },
		{ id: 'c', text: 'Расследование инцидента: собрать логи Sage, составить отчёт' },
		{ id: 'd', text: 'Update wiki page with release notes' },
		{ id: 'e', text: 'Создать тикет в Jira по результатам ревью' },
	]
	const ix = buildIndex(docs)
	it('кейс про aff пакет выше остальных', () => {
		const r = search(ix, 'aff пакет реализовать', 3)
		assert.equal(r[0]?.id, 'a')
		assert.ok(r.length <= 3)
		assert.ok(r.every((x, i) => i === 0 || (r[i - 1]?.score ?? 0) >= x.score))
	})
	it('нет совпадений и пустой индекс — пусто', () => {
		assert.deepEqual(search(ix, 'зебра', 5), [])
		assert.deepEqual(search(buildIndex([]), 'aff', 5), [])
	})
})

describe('similarity', () => {
	it('одинаковые 1, разные < 0.2', () => {
		const t = 'implement the aff package and add tests for it'
		assert.equal(similarity(t, t), 1)
		assert.ok(similarity(t, 'review merge request in gitlab and comment on diff') < 0.2)
		assert.equal(similarity('', ''), 0)
	})
})

describe('caseDigest', () => {
	const summary = [
		'# Пакет aff',
		'## Goal: Реализовать aff (type: implement)',
		'### Plan',
		'сделать пакет',
		'### Actions',
		'- код -> e1, coder -> готово (n 1–4)',
		'### Sources',
		'- repo/aff',
		'### User corrections',
		'- Proposed: x. User: "y" (n 5)',
		'### Open questions',
		'- что с CI',
	].join('\n')
	it('заголовок, цель, Actions и Sources; без Plan, поправок и Open questions', () => {
		const d = caseDigest(summary)
		assert.ok(d.includes('# Пакет aff') && d.includes('## Goal:') && d.includes('### Actions') && d.includes('repo/aff'))
		assert.ok(!d.includes('Open questions') && !d.includes('что с CI') && !d.includes('сделать пакет') && !d.includes('corrections'))
	})
})
