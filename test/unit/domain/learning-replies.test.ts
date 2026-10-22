import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	parseBuild,
	parseCaseAnalysis,
	parseComparison,
	parseConsistency,
	parseDescription,
	parseEdit,
	parseGrade,
	parseImprovement,
	parseMatch,
	parsePlan,
	parseResult,
	parseReview,
	parseSelection,
	parseVerdicts,
} from '../../../src/domain/learning-replies'

const wrap = (v: unknown): string => `Итог: ok\n<result>\n${JSON.stringify(v)}\n</result>\nСтатус: готово`

const stage = { n: 1, slug: 'read', title: 'Read', role: 'analyst', where: 'wiki', produce: 'notes', done: 'notes exist', gate: false, template: 'Read {key}' }
const build = {
	title: 'Review MR',
	description: 'Use when reviewing a merge request',
	taskType: 'review merge request',
	cases: ['c1', 'c2'],
	heldOut: null,
	params: [{ name: 'key', description: 'ticket', source: 'first message' }],
	sources: ['GitLab'],
	files: ['README.md'],
	behavior: ['ask before merging'],
	stages: [stage],
	rules: [{ text: 'Always run tests', stage: 1, evidence: [{ caseId: 'c1', anchor: 'n 3–5' }] }],
}

describe('parseResult', () => {
	it('берёт последний блок', () => {
		assert.deepEqual(parseResult('<result>{"a":1}</result> x <result>{"a":2}</result>'), { a: 2 })
	})
	it('терпит ограду кода', () => {
		assert.deepEqual(parseResult('<result>\n```json\n{"a":1}\n```\n</result>'), { a: 1 })
	})
	it('нет блока или битый JSON — null', () => {
		assert.equal(parseResult('nothing'), null)
		assert.equal(parseResult('<result>{oops</result>'), null)
	})
})

describe('parseMatch', () => {
	const ok = { groups: [{ task: 'review', taskType: 'review mr', playbookId: null, cases: [{ caseId: 'c1', anchor: 'n 1–4' }, { caseId: 'c2', anchor: 'n 7' }] }] }
	it('разбирает группы', () => {
		assert.deepEqual(parseMatch(wrap(ok)), [{ task: 'review', taskType: 'review mr', playbookId: null, cases: ok.groups[0]?.cases }])
	})
	it('выбрасывает неверные якоря и группы без кейсов', () => {
		const r = parseMatch(
			wrap({
				groups: [
					{ task: 'a', taskType: 't', playbookId: 'p-1', cases: [{ caseId: 'c1', anchor: 'n 1-2' }, { caseId: 'c2', anchor: 'about 5' }, { caseId: 'c3', anchor: 'n 9–2' }] },
					{ task: 'b', taskType: 't', playbookId: null, cases: [{ caseId: 'c1', anchor: 'foo' }] },
					{ task: 'c', taskType: 't', playbookId: null, cases: [] },
				],
			}),
		)
		assert.equal(r?.length, 1)
		const g = r.at(0)
		assert.deepEqual(g?.cases, [{ caseId: 'c1', anchor: 'n 1-2' }])
		assert.equal(g.playbookId, 'p-1')
	})
	it('пустой список групп допустим; без result и не та форма — null', () => {
		assert.deepEqual(parseMatch(wrap({ groups: [] })), [])
		assert.equal(parseMatch('text'), null)
		assert.equal(parseMatch(wrap({ groups: 'x' })), null)
	})
})

describe('parseCaseAnalysis', () => {
	it('разбирает', () => {
		assert.deepEqual(parseCaseAnalysis(wrap({ caseId: 'c1', analysis: 'text' })), { caseId: 'c1', analysis: 'text' })
	})
	it('не та форма — null', () => {
		assert.equal(parseCaseAnalysis(wrap({ caseId: 'c1' })), null)
		assert.equal(parseCaseAnalysis('x'), null)
	})
})

describe('parseBuild', () => {
	it('разбирает черновик и отбрасывает лишние поля', () => {
		const r = parseBuild(wrap({ ...build, extra: 1 }))
		assert.deepEqual(r, { ...build, tools: [] })
	})
	it('tools: верные принимаются, неверные имена, большие, повторы и сверх 8 отбрасываются', () => {
		const ok = { name: 'export.sh', description: 'dump; bash tools/export.sh', content: 'echo 1' }
		const tools = [
			ok,
			{ name: '../evil', description: 'd', content: 'x' },
			{ name: 'a/b.sh', description: 'd', content: 'x' },
			{ name: 'Upper.sh', description: 'd', content: 'x' },
			{ name: 'big.sh', description: 'd', content: 'x'.repeat(40_001) },
			{ name: 'export.sh', description: 'dup', content: 'y' },
			{ name: 'no-content' },
		]
		assert.deepEqual(parseBuild(wrap({ ...build, tools }))?.tools, [ok])
		const many = Array.from({ length: 12 }, (_, i) => ({ name: `t${i}.sh`, description: 'd', content: 'x' }))
		assert.equal(parseBuild(wrap({ ...build, tools: many }))?.tools?.length, 8)
		assert.deepEqual(parseBuild(wrap({ ...build, tools: 'nope' }))?.tools, [])
	})
	it('без этапов — null', () => {
		assert.equal(parseBuild(wrap({ ...build, stages: [] })), null)
		assert.equal(parseBuild(wrap({ ...build, stages: undefined })), null)
	})
	it('не та форма — null', () => {
		assert.equal(parseBuild(wrap({ ...build, stages: [{ ...stage, gate: 'no' }] })), null)
		assert.equal(parseBuild(wrap({ ...build, description: '' })), null)
		assert.equal(parseBuild(wrap({ ...build, sources: 'GitLab' })), null)
		assert.equal(parseBuild('x'), null)
	})
	it('правило с неверным якорем остаётся без этого доказательства', () => {
		const r = parseBuild(wrap({ ...build, rules: [{ text: 'r', stage: null, evidence: [{ caseId: 'c1', anchor: 'bad' }] }] }))
		assert.deepEqual(r?.rules, [{ text: 'r', stage: null, evidence: [] }])
	})
})

describe('parseVerdicts', () => {
	it('разбирает вердикты', () => {
		const v = [
			{ ruleId: 'r1', verdict: 'applied', anchor: 'n 3–4' },
			{ ruleId: 'r2', verdict: 'not_applicable', anchor: null },
		]
		assert.deepEqual(parseVerdicts(wrap({ verdicts: v })), v)
	})
	it('неизвестный вердикт — null; кривой якорь — null в поле', () => {
		assert.equal(parseVerdicts(wrap({ verdicts: [{ ruleId: 'r1', verdict: 'maybe', anchor: null }] })), null)
		assert.deepEqual(parseVerdicts(wrap({ verdicts: [{ ruleId: 'r1', verdict: 'applied', anchor: 'zzz' }] })), [{ ruleId: 'r1', verdict: 'applied', anchor: null }])
		assert.equal(parseVerdicts('x'), null)
	})
})

describe('parseImprovement', () => {
	const ok = {
		cause: 'non_compliance',
		edits: [{ file: 'stages/01-read.md', before: 'old', after: 'new', anchor: 'n 5' }],
		candidates: [{ text: 'Do X', stage: null, evidence: [{ caseId: 'c1', anchor: 'n 5' }] }],
	}
	it('разбирает', () => {
		assert.deepEqual(parseImprovement(wrap(ok)), ok)
		assert.deepEqual(parseImprovement(wrap({ cause: 'one_off', edits: [], candidates: [] }))?.cause, 'one_off')
	})
	it('не та форма — null', () => {
		assert.equal(parseImprovement(wrap({ ...ok, cause: 'bad' })), null)
		assert.equal(parseImprovement(wrap({ ...ok, edits: [{ file: 'f', before: '', after: 'x', anchor: 'n 1' }] })), null)
		assert.equal(parseImprovement('x'), null)
	})
})

describe('parseEdit', () => {
	it('разбирает файлы, заметку и пояснение', () => {
		assert.deepEqual(parseEdit(wrap({ files: { 'rules.md': 'text' }, note: 'watch X', summary: 'done' })), { files: { 'rules.md': 'text' }, note: 'watch X', summary: 'done' })
		assert.deepEqual(parseEdit(wrap({ files: {}, note: null, summary: 'nothing' })), { files: {}, note: null, summary: 'nothing' })
	})
	it('не та форма — null', () => {
		assert.equal(parseEdit(wrap({ files: { a: 1 }, summary: 's' })), null)
		assert.equal(parseEdit(wrap({ files: {} })), null)
		assert.equal(parseEdit('x'), null)
	})
})

describe('parseGrade / parseReview / parseConsistency', () => {
	for (const [name, parse] of [['grade', parseGrade], ['review', parseReview], ['consistency', parseConsistency]] as const) {
		it(`${name}: разбирает и принимает отсутствующий список`, () => {
			assert.deepEqual(parse(wrap({ critical: ['a'], notes: ['b'] })), { critical: ['a'], notes: ['b'] })
			assert.deepEqual(parse(wrap({ critical: [] })), { critical: [], notes: [] })
		})
		it(`${name}: без critical — null (пустой объект не равен «замечаний нет»)`, () => {
			assert.equal(parse(wrap({})), null)
			assert.equal(parse(wrap({ notes: ['a'] })), null)
			assert.equal(parse(wrap({ verdict: 'fail', problems: ['x'] })), null)
		})
		it(`${name}: не та форма — null`, () => {
			assert.equal(parse(wrap({ critical: 'a', notes: [] })), null)
			assert.equal(parse(wrap({ critical: [1], notes: [] })), null)
			assert.equal(parse('x'), null)
		})
	}
})

describe('parsePlan / parseComparison / parseSelection / parseDescription', () => {
	it('parsePlan', () => {
		assert.deepEqual(parsePlan(wrap({ plan: '1. a' })), { plan: '1. a' })
		assert.equal(parsePlan(wrap({ plan: '' })), null)
		assert.equal(parsePlan('x'), null)
	})
	it('parseComparison', () => {
		assert.deepEqual(parseComparison(wrap({ winner: 'A', reason: 'r' })), { winner: 'A', reason: 'r' })
		assert.deepEqual(parseComparison(wrap({ winner: 'TIE', reason: 'r' })), { winner: 'tie', reason: 'r' })
		assert.equal(parseComparison(wrap({ winner: 'C', reason: 'r' })), null)
		assert.equal(parseComparison('x'), null)
	})
	it('parseSelection', () => {
		assert.deepEqual(parseSelection(wrap({ playbookId: 'p-1' })), { playbookId: 'p-1' })
		assert.deepEqual(parseSelection(wrap({ playbookId: null })), { playbookId: null })
		assert.equal(parseSelection(wrap({})), null)
		assert.equal(parseSelection(wrap({ playbookId: 5 })), null)
	})
	it('parseDescription', () => {
		assert.deepEqual(parseDescription(wrap({ description: 'Use when x' })), { description: 'Use when x' })
		assert.equal(parseDescription(wrap({ description: ' ' })), null)
	})
})
