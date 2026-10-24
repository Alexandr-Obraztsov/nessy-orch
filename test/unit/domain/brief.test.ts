/** Описание v2: parseBrief, goalsOf, stripGoals — круговые случаи. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { briefProblems, goalsOf, parseBrief, stripGoals } from '../../../src/domain/brief'

const goal = (title: string, type: string): string => [`## Goal: ${title} (type: ${type})`, '### Plan', `- plan of ${title}`, '- second line', '### Actions', `- did ${title} (n 1–2)`, '### User corrections', '- none', '### Sources', '- none', '### Skipped', '- n 3 — noise only here', '### Open questions', '- none'].join('\n')
const BRIEF = ['## Brief', 'gist: Reviewed an MR and fixed it.', 'entities: PROJ-1, repo/x, docs/a.md', 'skeleton:', '1. explorer reads', '2. coder fixes'].join('\n')
const text = ['# Session', goal('review', 'review merge request'), goal('fix', 'fix bug'), BRIEF].join('\n')

describe('brief', () => {
	it('parseBrief: три поля; нет раздела или поля — null', () => {
		assert.deepEqual(parseBrief(text), { gist: 'Reviewed an MR and fixed it.', entities: ['PROJ-1', 'repo/x', 'docs/a.md'], skeleton: ['explorer reads', 'coder fixes'] })
		assert.equal(parseBrief('# S\n' + goal('a', 'b')), null)
		assert.equal(parseBrief(['## Brief', 'gist: x', 'entities: a'].join('\n')), null)
		assert.equal(parseBrief(['## Brief', 'gist: x', 'entities: none', 'skeleton:', '1. a'].join('\n')), null)
		// маркеры списка и жирный шрифт терпимы
		assert.equal(parseBrief(['## Brief', '- **gist:** x', '- **entities:** a, b', '- **skeleton:**', '  1) s'].join('\n'))?.skeleton[0], 's')
	})

	it('parseBrief не заходит за следующий заголовок; briefProblems — лимиты', () => {
		assert.equal(parseBrief([BRIEF, '## Goal: z (type: t)', 'skeleton: late'].join('\n'))?.skeleton.length, 2)
		assert.deepEqual(briefProblems(text), [])
		assert.deepEqual(briefProblems('# S'), ['no "## Brief" section'])
	})

	it('goalsOf: название, тип, первая строка Plan', () => {
		assert.deepEqual(goalsOf(text), [
			{ title: 'review', type: 'review merge request', plan: 'plan of review' },
			{ title: 'fix', type: 'fix bug', plan: 'plan of fix' },
		])
		assert.deepEqual(goalsOf('# S'), [])
	})

	it('stripGoals: убирает цель целиком, сохраняет заголовок, остальные цели и Brief', () => {
		const out = stripGoals(text, ['review']) ?? ''
		assert.deepEqual(goalsOf(out).map(g => g.title), ['fix'])
		assert.ok(out.startsWith('# Session\n## Goal: fix'))
		assert.ok(!out.includes('did review'))
		assert.deepEqual(parseBrief(out), parseBrief(text))
		assert.equal(out.match(/### Skipped/g)?.length, 1)
	})

	it('stripGoals: неизвестное название ничего не меняет; все цели — null; без Brief', () => {
		assert.equal(stripGoals(text, ['nope']), text)
		assert.equal(stripGoals(text, ['review', 'fix']), null)
		const noBrief = ['# S', goal('a', 't')].join('\n')
		assert.equal(stripGoals(noBrief, ['a']), null)
		assert.equal(stripGoals(['# S', goal('a', 't'), goal('b', 't')].join('\n'), ['b']), ['# S', goal('a', 't')].join('\n'))
	})
})
