import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlaybookView } from '../../../shared/types'
import { parseDocument, renderDocument } from '../../../src/domain/playbook-document'
import { must, samplePlaybook } from '../../support/sample-playbook'

const rich = (): PlaybookView => {
	const p = samplePlaybook()
	return {
		...p,
		title: 'Multi "quoted" title',
		params: [
			{ name: 'package', description: 'name — with dash', source: 'ticket title' },
			{ name: 'x', description: 'no source', source: '' },
		],
		sources: ['Jira ticket', 'wiki\n  page'],
		behavior: ['Ask before pushing', 'Reply in Russian'],
		tools: [{ name: 'run.sh', description: 'Exports tickets', content: 'echo hi' }],
		basedOn: [{ session: 'Разбор MR', date: '2026-10-01' }],
		stages: [
			{ ...must(p.stages[0]), where: 'repo,\nticket', template: '## not a heading\n```\ninner\n```' },
			{ ...must(p.stages[1]), role: null, gate: true },
		],
		rules: [
			...p.rules,
			{
				id: 'r-ab12cd',
				text: 'Two\nlines',
				stage: 1,
				status: 'active',
				up: 5,
				down: 0,
				evidence: [{ caseId: 'c3', anchor: 'n 1' }],
				against: [],
				lastAppliedAt: null,
				createdAt: '2026-10-01T00:00:00Z',
			},
			{
				id: 'r-old',
				text: 'Old',
				stage: null,
				status: 'archived',
				up: 1,
				down: 4,
				evidence: [],
				against: [],
				lastAppliedAt: null,
				createdAt: '2026-10-01T00:00:00Z',
			},
		],
	}
}

describe('playbook-document', () => {
	it('круговой тест: parse(render(p)) возвращает структуру без потерь', () => {
		for (const p of [samplePlaybook(), rich()]) {
			const { draft, issues, notices } = parseDocument(renderDocument(p, 'my notes'), p)
			assert.deepEqual(issues, [])
			assert.deepEqual(notices, [])
			assert.deepEqual([draft.title, draft.description, draft.taskType], [p.title, p.description, p.taskType])
			assert.deepEqual(draft.params, p.params)
			assert.deepEqual(draft.sources, p.sources)
			assert.deepEqual(draft.files, p.files)
			assert.deepEqual(draft.behavior, p.behavior)
			assert.deepEqual(draft.stages, p.stages)
			assert.deepEqual(draft.rules, p.rules)
			assert.deepEqual([draft.added, draft.archived, draft.notes], [[], [], 'my notes'])
		}
	})

	it('архивные правила не показываются, кандидаты — в ### Candidates, маркер с этапом', () => {
		const md = renderDocument(rich(), '')
		assert.doesNotMatch(md, /Old/)
		assert.match(md, /^- Run lint <!-- r1 stage:2 -->$/m)
		assert.ok(md.indexOf('### Candidates') < md.indexOf('Maybe <!-- r2 -->'))
		assert.match(md, /^## Based on\n- Разбор MR — 2026-10-01$/m)
	})

	it('правка текста — то же правило; маркер пропал — архив; без маркера — новое (в Candidates — кандидат)', () => {
		const p = samplePlaybook()
		const md = renderDocument(p, '')
			.replace('- Run lint <!--', '- Run all lint <!--')
			.replace(/^- Maybe <!-- r2 -->$/m, '- Fresh candidate')
			.replace('## Rules\n', '## Rules\n- Fresh active\n')
		const { draft, issues } = parseDocument(md, p)
		assert.deepEqual(issues, [])
		assert.deepEqual(
			draft.rules.map(r => [r.id, r.text, r.status, r.up]),
			[
				['r1', 'Run all lint', 'active', 3],
				['r2', 'Maybe', 'archived', 2],
			],
		)
		assert.deepEqual(draft.archived, ['r2'])
		assert.deepEqual(draft.added, [
			{ text: 'Fresh active', stage: null, status: 'active' },
			{ text: 'Fresh candidate', stage: null, status: 'candidate' },
		])
	})

	it('ошибки разбора: нет description, нет этапов, битый frontmatter', () => {
		const p = samplePlaybook()
		const md = renderDocument(p, '')
		assert.match(parseDocument(md.replace(/^description: .*$/m, 'description: ""'), p).issues.join('\n'), /description/)
		assert.match(parseDocument(md.slice(0, md.indexOf('### 1.')) + '## Rules\n', p).issues.join('\n'), /этапов/)
		assert.match(parseDocument(md.replace(/^---\n/, ''), p).issues.join('\n'), /Frontmatter/)
		assert.match(parseDocument('---\nname: x\ndescription: "Use when"\n', p).issues.join('\n'), /Frontmatter/)
	})

	it('Tools только для чтения: правка — замечание, структура не меняется; незнакомый раздел уходит в notes', () => {
		const p = rich()
		const md = renderDocument(p, 'n1').replace('Exports tickets', 'Deletes tickets') + '\n## Extra\nkeep me\n'
		const { draft, issues, notices } = parseDocument(md, p)
		assert.deepEqual(issues, [])
		assert.match(notices.join(), /Tools/)
		assert.equal(draft.notes, 'n1\n\n## Extra\nkeep me')
	})
})
