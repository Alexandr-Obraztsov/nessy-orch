import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlaybookView } from '../../../shared/types'
import { lintPlaybook, validDescription } from '../../../src/domain/playbook-lint'
import { renderPlaybook } from '../../../src/domain/playbook-render'
import { samplePlaybook } from '../../support/sample-playbook'

const known = new Set(['c1', 'c2', 'c3'])

function lint(p: PlaybookView, mutate?: (f: Record<string, string>) => void) {
	const files = renderPlaybook(p, '', '')
	mutate?.(files)
	return lintPlaybook(p, files, known, { strictEvidence: true })
}

function skillWith(front: string): (f: Record<string, string>) => void {
	return f => { f['SKILL.md'] = `---\n${front}\n---\n# x\n` }
}

describe('playbook-lint', () => {
	it('эталон: нет critical', () => {
		assert.deepEqual(lint(samplePlaybook()).filter(i => i.level === 'critical'), [])
	})

	const cases: Array<[string, (f: Record<string, string>) => void, string]> = [
		['нет SKILL.md', f => { delete f['SKILL.md'] }, 'SKILL.md'],
		['нет frontmatter', f => { f['SKILL.md'] = '# x' }, 'SKILL.md'],
		['нет name', skillWith('description: "Use when x"'), 'SKILL.md name'],
		['нет description', skillWith('name: a'), 'SKILL.md description'],
		['name не kebab', skillWith('name: Aff_Pkg\ndescription: "Use when x"'), 'SKILL.md name'],
		['name длиннее 64', skillWith(`name: ${'a'.repeat(65)}\ndescription: "Use when x"`), 'SKILL.md name'],
		['description > 1024', skillWith(`name: a\ndescription: "Use when ${'x'.repeat(1030)}"`), 'SKILL.md description'],
		['угловые скобки', skillWith('name: a\ndescription: "Use when <x>"'), 'SKILL.md description'],
		['не Use when', skillWith('name: a\ndescription: "Does stuff"'), 'SKILL.md description'],
		['лишний ключ', skillWith('name: a\ndescription: "Use when x"\ncolor: red'), 'SKILL.md'],
		['> 500 строк', f => { f['SKILL.md'] = `${f['SKILL.md'] ?? ''}${'line\n'.repeat(500)}` }, 'SKILL.md'],
	]
	for (const [title, mutate, where] of cases) {
		it(`critical: ${title}`, () => {
			const c = lint(samplePlaybook(), mutate).filter(i => i.level === 'critical')
			assert.equal(c.length, 1, JSON.stringify(c))
			assert.equal(c[0]?.where, where)
		})
	}

	it('critical: нет этапов', () => {
		const p = { ...samplePlaybook(), stages: [] }
		const c = lint(p).filter(i => i.level === 'critical')
		assert.deepEqual(c.map(i => i.where), ['stages'])
	})

	it('critical: активное правило с одним кейсом', () => {
		const p = samplePlaybook()
		const r = p.rules[0]
		assert.ok(r)
		r.evidence = [{ caseId: 'c1', anchor: 'n 1' }, { caseId: 'c1', anchor: 'n 2' }]
		const c = lint(p).filter(i => i.level === 'critical')
		assert.deepEqual(c.map(i => i.where), ['rule r1'])
	})

	it('неизвестный кейс — note, а не critical; плохой якорь — critical', () => {
		const p = samplePlaybook()
		const r = p.rules[0]
		assert.ok(r)
		r.evidence = [...r.evidence, { caseId: 'ghost', anchor: 'n 1' }]
		assert.equal(lint(p).filter(i => i.level === 'critical').length, 0)
		assert.deepEqual(lint(p).filter(i => i.level === 'note').map(i => i.where), ['rule r1'])
		r.evidence = [{ caseId: 'c1', anchor: 'n 1' }, { caseId: 'c2', anchor: 'n 2' }, { caseId: 'c3', anchor: 'row 7' }]
		assert.equal(lint(p).filter(i => i.level === 'critical').length, 1)
	})

	it('note: этап без done, параметр без source', () => {
		const p = samplePlaybook()
		const s = p.stages[0]
		const x = p.params[0]
		assert.ok(s && x)
		s.done = ''
		x.source = ''
		const issues = lint(p)
		assert.equal(issues.filter(i => i.level === 'critical').length, 0)
		assert.deepEqual(issues.filter(i => i.level === 'note').map(i => i.where), ['stage 1', 'param package'])
	})

	it('active с < 2 известными кейсами: critical при strictEvidence, иначе note', () => {
		const p = samplePlaybook()
		const r = p.rules[0]
		assert.ok(r)
		r.evidence = [{ caseId: 'c1', anchor: 'n 1' }, { caseId: 'gone', anchor: 'n 2' }]
		const files = renderPlaybook(p, '', '')
		const strict = lintPlaybook(p, files, known, { strictEvidence: true })
		assert.deepEqual(strict.filter(i => i.level === 'critical').map(i => i.where), ['rule r1'])
		const loose = lintPlaybook(p, files, known, { strictEvidence: false })
		assert.deepEqual(loose.filter(i => i.level === 'critical'), [])
		assert.equal(loose.filter(i => i.level === 'note' && i.where === 'rule r1').length, 2)
	})

	it('validDescription', () => {
		assert.equal(validDescription('Use when fixing a bug'), null)
		assert.match(validDescription('Fixes bugs') ?? '', /Use when/)
		assert.match(validDescription(`Use when ${'x'.repeat(1020)}`) ?? '', /too long/)
		assert.match(validDescription('Use when <x>') ?? '', /angle/)
		assert.notEqual(validDescription('  '), null)
	})
})
