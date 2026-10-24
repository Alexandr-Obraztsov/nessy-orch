import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CASE_CARD_MAX, PLAYBOOK_CARD_MAX, caseCard, playbookCard } from '../../../src/domain/cards'
import { samplePlaybook } from '../../support/sample-playbook'

const SUMMARY = `# Review MR 12
## Goal: Review MR !12 (type: review merge request)
### Plan
- read the diff, comment, summarize
### Actions
- read the diff — claude — 4 files (n 2–5)
- wrote comments — claude — 3 threads (n 6–9)
### Sources
- GitLab
## Brief
gist: reviewed MR !12 of the aff package and posted three comments
entities: MR !12, aff-package, GitLab
skeleton:
1. read the diff
2. write review comments
3. summarize for the user
`

describe('caseCard', () => {
	it('название, дата, цели с типом и Plan, суть, сущности, скелет из Brief', () => {
		const c = caseCard({ title: 'Review MR 12', date: '2026-10-01T10:00:00Z', summary: SUMMARY })
		assert.match(c, /^Review MR 12 · 2026-10-01\n/)
		assert.match(c, /goals: Review MR !12 \[review merge request — read the diff/)
		assert.match(c, /gist: reviewed MR !12/)
		assert.match(c, /entities: MR !12, aff-package, GitLab/)
		assert.match(c, /skeleton: 1\) read the diff 2\) write review comments 3\) summarize/)
		assert.ok(c.length <= CASE_CARD_MAX)
	})

	it('без Brief: эвристика из целей и первых Actions', () => {
		const c = caseCard({ title: 'Old', date: '2026-10-01', summary: SUMMARY.slice(0, SUMMARY.indexOf('## Brief')) })
		assert.match(c, /gist: Review MR !12/)
		assert.match(c, /skeleton: 1\) read the diff 2\) wrote comments/)
		assert.match(c, /entities: .*MR !12/)
	})

	it('длинный Brief и много целей укладываются в 500 знаков', () => {
		const long = 'word '.repeat(300)
		const goals = Array.from({ length: 12 }, (_v, i) => `## Goal: Goal number ${i} with a long title ${long.slice(0, 40)} (type: some type)\n### Plan\n- ${long.slice(0, 80)}\n`).join('')
		const s = `# T\n${goals}## Brief\ngist: ${long}\nentities: ${Array.from({ length: 12 }, (_v, i) => `entity-${i}-${long.slice(0, 20)}`).join(', ')}\nskeleton:\n${Array.from({ length: 6 }, (_v, i) => `${i + 1}. ${long.slice(0, 100)}`).join('\n')}\n`
		const c = caseCard({ title: long, date: '2026-10-01', summary: s })
		assert.ok(c.length <= CASE_CARD_MAX, String(c.length))
		assert.match(c, /gist: /)
		assert.match(c, /skeleton: /)
	})
})

describe('playbookCard', () => {
	it('название, Use when, параметры, этапы, число правил и кейсов, сессии-основания', () => {
		const c = playbookCard({ ...samplePlaybook(), basedOn: [{ session: 'Разбор MR', date: '2026-10-01' }] })
		assert.match(c, /^Implement aff package \[active\] · 2 rules · 3 cases\n/)
		assert.match(c, /use: Use when implementing an aff package/)
		assert.match(c, /params: package/)
		assert.match(c, /stages: 1\) Research 2\) Implement/)
		assert.match(c, /based on sessions: Разбор MR/)
		assert.ok(c.length <= PLAYBOOK_CARD_MAX)
	})

	it('огромный плейбук укладывается в 600 знаков', () => {
		const p = samplePlaybook()
		const big = { ...p, description: 'Use when '.repeat(200), stages: Array.from({ length: 30 }, (_v, i) => ({ ...p.stages[0]!, n: i + 1, title: `Stage title number ${i}` })), basedOn: Array.from({ length: 30 }, (_v, i) => ({ session: `Session ${i} long`, date: '2026-10-01' })) }
		assert.ok(playbookCard(big).length <= PLAYBOOK_CARD_MAX)
	})
})
