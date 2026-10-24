import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlaybookView, RuleView } from '../../../shared/types'
import type { RuleVerdict } from '../../../src/domain/playbook.types'
import { applyVerdicts, countCorrections, promoteCandidates, recount, ruleCounters, trialDecision } from '../../../src/domain/rule-counters'
import { samplePlaybook } from '../../support/sample-playbook'

const WEEK = 7 * 24 * 3600 * 1000
const KNOWN = new Set(['c1', 'c2', 'c3', 'c4'])
const NOW = Date.parse('2026-12-01T00:00:00Z')
const v = (ruleId: string, verdict: RuleVerdict['verdict'], anchor: string | null = 'n 1'): RuleVerdict => ({ ruleId, verdict, anchor })
const base = {
	evidence: [
		{ caseId: 'c1', anchor: 'n 1' },
		{ caseId: 'c2', anchor: 'n 1' },
	],
	createdAt: new Date(NOW - WEEK).toISOString(),
}

function r1(p: { rules: RuleView[] }): RuleView {
	const r = p.rules[0]
	assert.ok(r)
	return r
}

function state(): PlaybookView & { verdicts: Record<string, RuleVerdict[]> } {
	const p = samplePlaybook()
	p.rules = [rule('r1', 'candidate', [{ caseId: 'c1', anchor: 'n 1' }])]
	return { ...p, verdicts: {} }
}
function rule(id: string, status: RuleView['status'], evidence: RuleView['evidence'], against: RuleView['against'] = []): RuleView {
	return { id, text: id, stage: null, status, up: 2, down: 0, evidence, against, lastAppliedAt: null, createdAt: new Date(NOW - WEEK).toISOString() }
}

describe('rule-counters', () => {
	it('ruleCounters: applied, violated, затухание', () => {
		assert.equal(ruleCounters(base, [v('r', 'applied'), v('r', 'applied')], NOW).up, 4)
		assert.equal(ruleCounters(base, [v('r', 'violated_by_user_correction')], NOW).down, 1)
		const old = { ...base, createdAt: new Date(NOW - 17 * WEEK).toISOString() }
		const c = ruleCounters(old, [], NOW)
		assert.equal(c.up, 0)
		assert.equal(c.status, 'archived')
		assert.equal(ruleCounters(base, [], NOW).status, 'active')
	})

	it('applyVerdicts заменяет вердикты кейса, а не складывает', () => {
		let p = state()
		p = applyVerdicts(p, 'c2', [v('r1', 'applied', 'n 5–6')], NOW)
		p = applyVerdicts(p, 'c2', [v('r1', 'applied', 'n 5–6')], NOW)
		const r = r1(p)
		assert.equal(r.up, 3)
		assert.equal(r.evidence.length, 2)
		assert.equal(r.lastAppliedAt, new Date(NOW).toISOString())
		// вердикт сменился: применение снято, поправка добавлена
		p = applyVerdicts(p, 'c2', [v('r1', 'violated_by_user_correction', 'n 9')], NOW)
		assert.equal(r1(p).up, 2)
		assert.equal(r1(p).down, 1)
		assert.deepEqual(r1(p).against, [{ caseId: 'c2', anchor: 'n 9' }])
		assert.deepEqual(r1(p).evidence, [{ caseId: 'c1', anchor: 'n 1' }])
	})

	it('applyVerdicts: ▲−▼ ≤ 0 отправляет в архив', () => {
		let p = state()
		p.rules = [
			rule('r1', 'active', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c2', anchor: 'n 1' },
			]),
		]
		p = applyVerdicts(p, 'c3', [v('r1', 'violated_by_user_correction')], NOW)
		p = applyVerdicts(p, 'c4', [v('r1', 'violated_by_user_correction')], NOW)
		assert.equal(r1(p).status, 'archived')
	})

	it('promoteCandidates: два кейса «за» — активно; «против» — остаётся кандидатом', () => {
		const p = state()
		p.rules = [
			rule('a', 'candidate', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c2', anchor: 'n 1' },
			]),
			rule(
				'b',
				'candidate',
				[
					{ caseId: 'c1', anchor: 'n 1' },
					{ caseId: 'c2', anchor: 'n 1' },
				],
				[{ caseId: 'c3', anchor: 'n 1' }],
			),
			rule('c', 'candidate', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c1', anchor: 'n 2' },
			]),
		]
		assert.deepEqual(
			promoteCandidates(p, KNOWN).rules.map(r => r.status),
			['active', 'candidate', 'candidate'],
		)
	})

	it('applyVerdicts: поправка без разбираемого якоря не считается', () => {
		for (const anchor of [null, 'row 7', 'n 9-3']) {
			const p = applyVerdicts(state(), 'c2', [v('r1', 'violated_by_user_correction', anchor)], NOW)
			assert.equal(r1(p).down, 0, String(anchor))
			assert.deepEqual(r1(p).against, [])
		}
		const ok = applyVerdicts(state(), 'c2', [v('r1', 'violated_by_user_correction', 'n 9')], NOW)
		assert.equal(r1(ok).down, 1)
	})

	it('promoteCandidates: несуществующие кейсы и битые якоря не повышают', () => {
		const p = state()
		p.rules = [
			rule('ghost', 'candidate', [
				{ caseId: 'g1', anchor: 'n 1' },
				{ caseId: 'g2', anchor: 'n 1' },
			]),
			rule('half', 'candidate', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'g2', anchor: 'n 1' },
			]),
			rule('badanchor', 'candidate', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c2', anchor: 'row' },
			]),
			rule('ok', 'candidate', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c2', anchor: 'n 2–3' },
			]),
		]
		assert.deepEqual(
			promoteCandidates(p, KNOWN).rules.map(r => r.status),
			['candidate', 'candidate', 'candidate', 'active'],
		)
	})

	it('recount: затухание без вердиктов отправляет старое правило в архив, свежее не трогает', () => {
		const p = state()
		p.rules = [
			{
				...rule('old', 'active', [
					{ caseId: 'c1', anchor: 'n 1' },
					{ caseId: 'c2', anchor: 'n 1' },
				]),
				createdAt: new Date(NOW - 17 * WEEK).toISOString(),
			},
			rule('fresh', 'active', [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c2', anchor: 'n 1' },
			]),
			{ ...rule('cand', 'candidate', [{ caseId: 'c1', anchor: 'n 1' }]), createdAt: new Date(NOW - 17 * WEEK).toISOString() },
		]
		const { state: next, changed } = recount(p, NOW)
		assert.deepEqual(
			next.rules.map(r => r.status),
			['archived', 'active', 'archived'],
		)
		assert.deepEqual(changed, [
			{ ruleId: 'old', from: 'active', to: 'archived' },
			{ ruleId: 'cand', from: 'candidate', to: 'archived' },
		])
		assert.equal(next.rules[0]?.up, 0)
		assert.equal(recount(next, NOW).changed.length, 0)
	})

	it('trialDecision', () => {
		const t = (before: number, corrections: number[]) => trialDecision({ before, cases: corrections.map((_, i) => `c${i}`), corrections })
		assert.equal(t(1, [1, 0]), 'pending')
		assert.equal(t(1, [1, 0, 2]), 'pass')
		assert.equal(t(1, [3, 2, 2]), 'fail')
	})

	it('countCorrections: два пункта и none', () => {
		const s = '## Goal 1\n### User corrections\n- no, use X\n- also Y\n### Actions\n- did stuff\n## Goal 2\n### User corrections\n- none\n'
		assert.equal(countCorrections(s), 2)
		assert.equal(countCorrections('nothing'), 0)
	})
})
