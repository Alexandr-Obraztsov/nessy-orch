/** Судья (счётчики, активация кандидатов, пробный режим) и улучшатель плейбука. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import type { JobContext } from '../../../src/application/learning/handlers.types'
import { editHash, improveHandler } from '../../../src/application/learning/improve.handler'
import { judgeHandler } from '../../../src/application/learning/judge.handler'
import type { CaseState, JobState, PlaybookState } from '../../../src/application/learning/learning.types'
import { PlaybookService } from '../../../src/application/learning/playbook.service'
import { parseLearningSettings } from '../../../src/domain/learning-settings'
import type { RawEvent } from '../../../src/domain/learning.types'
import { renderPlaybook } from '../../../src/domain/playbook-render'
import type { JobKind } from '../../../shared/types'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const NOW = Date.parse('2026-10-02T10:00:00.000Z')
const CREATED = '2026-10-01T00:00:00Z'

const SUMMARY = `# Задача
### Actions
- сделал X (n 1–2)
### User corrections
- пользователь поправил Y (n 4–5)
### Open questions
- none
`

const SUMMARY_3 = `# Задача
### User corrections
- первая (n 2)
- вторая (n 3)
- третья (n 4)
`

const baseCase: CaseState = {
	id: 'c1', title: 'Кейс', sessions: ['s1'], status: 'ready', goals: [], events: 10, coveredUntil: 10, createdAt: CREATED, updatedAt: CREATED, closedAt: CREATED, playbook: 'p-1@1', source: 'live',
	feedSeq: 0, transcripts: {}, nextN: 11, lastEventAt: 0, lastRunAt: 0, nessyCalls: false, hinted: [],
}

const rule = (id: string, status: 'active' | 'candidate', evidence: Array<{ caseId: string; anchor: string }>): PlaybookState['rules'][number] => ({
	id, text: `Правило ${id}`, stage: null, status, up: 2, down: 0, evidence, against: [], lastAppliedAt: null, createdAt: CREATED,
})

const state = (over: Partial<PlaybookState> = {}): PlaybookState => ({ ...samplePlaybook(), id: 'p-1', rules: [], version: 1, verdicts: {}, rejectedEdits: [], reviewAttempts: 0, ...over })

const events = (): RawEvent[] => Array.from({ length: 10 }, (_, i) => ({ n: i + 1, ts: NOW, kind: 'user', from: 'you', to: null, text: `событие ${i + 1}`, ref: `r${i}` }))

describe('judge и improve', () => {
	let pstore: MemoryPlaybookStore
	let pb: PlaybookService
	let summary: string
	let replies: string[]
	let agentPrompts: string[]
	let queued: Array<{ kind: JobKind; subject: string; caseId?: string; payload?: Record<string, unknown> | null }>
	let ids: number

	const seed = (p: PlaybookState): void => {
		pstore.savePlaybook(p, renderPlaybook(p, '', ''), 'init')
		pb.load()
		pb.publishActive()
	}
	const job = (kind: JobKind): JobState => ({
		id: 'j1', kind, caseId: 'c1', subject: kind === 'judge' ? 'judge:c1' : 'improve:c1', status: 'running', attempts: 0, agentId: null, error: null, note: null, range: null,
		createdAt: CREATED, startedAt: CREATED, finishedAt: null, final: false, retryAt: null, payload: null,
	})
	const ctxFor = (kind: JobKind): JobContext => ({
		job: job(kind),
		now: () => NOW,
		settings: () => parseLearningSettings({}),
		runAgent: (_n, _t, prompt) => {
			agentPrompts.push(prompt)
			const text = replies.shift()
			return text === undefined ? Promise.reject(new Error('нет ответа')) : Promise.resolve({ agentId: 'a', text })
		},
		prompt: name => (name === 'judge' ? 'R:{{rules}}\nS:{{summary}}\nE:{{events}}' : 'P:{{playbook}}\nS:{{summary}}\nE:{{events}}\nX:{{rejected}}\nN:{{notes}}'),
		cases: {
			get: id => (id === 'c1' ? { ...baseCase } : null),
			all: () => [baseCase],
			summary: () => summary,
			notes: () => '',
			raw: (_id, from, to) => events().filter(e => e.n >= from && (to === undefined || e.n <= to)),
			update: () => undefined,
			writeSummary: () => true,
			writeNotes: () => undefined,
			seal: () => undefined,
		},
		playbooks: pb,
		enqueue: (k, s, o) => void queued.push({ kind: k, subject: s, caseId: o?.caseId, payload: o?.payload }),
		chat: () => undefined,
		finish: () => undefined,
		changed: () => undefined,
	})
	const verdicts = (list: unknown[]): string => `<result>${JSON.stringify({ verdicts: list })}</result>`

	beforeEach(() => {
		pstore = new MemoryPlaybookStore()
		ids = 0
		pb = new PlaybookService({ store: pstore, hub: new Hub(), clock: { now: () => NOW }, ids: { next: () => `id${++ids}` }, caseOf: () => ({ playbook: 'p-1@1' }) })
		summary = SUMMARY
		replies = []
		agentPrompts = []
		queued = []
	})

	describe('судья', () => {
		it('applied/violated меняют счётчики; повторное закрытие кейса даёт те же числа', async () => {
			seed(state({ rules: [rule('r1', 'active', []), rule('r2', 'active', [])] }))
			const reply = verdicts([
				{ ruleId: 'r1', verdict: 'applied', anchor: 'n 2' },
				{ ruleId: 'r2', verdict: 'violated_by_user_correction', anchor: 'n 4–5' },
			])
			replies = [reply, reply]
			await judgeHandler.run(ctxFor('judge'))
			const first = pb.need('p-1')
			assert.deepEqual([first.rules[0]?.up, first.rules[0]?.down, first.rules[1]?.up, first.rules[1]?.down], [3, 0, 2, 1])
			const versions = pstore.versions('p-1').length
			await judgeHandler.run(ctxFor('judge'))
			const again = pb.need('p-1')
			assert.deepEqual([again.rules[0]?.up, again.rules[0]?.down, again.rules[1]?.up, again.rules[1]?.down], [3, 0, 2, 1])
			assert.equal(pstore.versions('p-1').length, versions)
			assert.match(agentPrompts[0] ?? '', /r1/)
			assert.match(agentPrompts[0] ?? '', /событие 4/)
		})

		it('кандидат со вторым кейсом «за» становится active, в журнале rule_activated с откатом', async () => {
			seed(state({ rules: [rule('rc', 'candidate', [{ caseId: 'c0', anchor: 'n 1' }])] }))
			replies = [verdicts([{ ruleId: 'rc', verdict: 'applied', anchor: 'n 2' }])]
			await judgeHandler.run(ctxFor('judge'))
			assert.equal(pb.need('p-1').rules[0]?.status, 'active')
			const entry = pb.journal().find(e => e.kind === 'rule_activated')
			assert.ok(entry)
			assert.deepEqual(JSON.parse(entry.report ?? '{}'), { ruleId: 'rc', prevStatus: 'candidate' })
			assert.equal(entry.revertible, true)
			pb.revert(entry.id)
			assert.equal(pb.need('p-1').rules[0]?.status, 'candidate')
		})

		it('правило уходит в архив при up − down ≤ 0: rule_archived', async () => {
			seed(state({ rules: [{ ...rule('r1', 'active', []), up: 2 }] }))
			replies = [verdicts([{ ruleId: 'r1', verdict: 'violated_by_user_correction', anchor: 'n 4' }])]
			// с вердиктами ≥ 2 нарушений кейс один — берём два кейса через заранее записанный вердикт
			const p = pb.need('p-1')
			seed({ ...p, verdicts: { c0: [{ ruleId: 'r1', verdict: 'violated_by_user_correction', anchor: 'n 1' }, { ruleId: 'r1', verdict: 'violated_by_user_correction', anchor: 'n 2' }] } })
			await judgeHandler.run(ctxFor('judge'))
			assert.equal(pb.need('p-1').rules[0]?.status, 'archived')
			assert.ok(pb.journal().some(e => e.kind === 'rule_archived'))
		})

		it('нет плейбука — без агента', async () => {
			summary = SUMMARY
			await judgeHandler.run(ctxFor('judge'))
			assert.equal(agentPrompts.length, 0)
			assert.equal(queued.length, 0)
		})

		it('поправки в описании → improve с subject improve:<кейс>', async () => {
			seed(state({ rules: [rule('r1', 'active', [])] }))
			replies = [verdicts([{ ruleId: 'r1', verdict: 'not_applicable', anchor: null }])]
			await judgeHandler.run(ctxFor('judge'))
			assert.deepEqual(queued.map(q => [q.kind, q.subject, q.caseId]), [['improve', 'improve:c1', 'c1']])
			queued = []
			summary = '# T\n### User corrections\n- none\n'
			replies = [verdicts([{ ruleId: 'r1', verdict: 'not_applicable', anchor: null }])]
			await judgeHandler.run(ctxFor('judge'))
			assert.equal(queued.length, 0)
		})

		it('пробный режим: поправок больше прежнего → disabled, плагин без плейбука', async () => {
			seed(state({ status: 'trial', rules: [rule('r1', 'active', [])], trial: { before: 1, cases: ['a', 'b'], corrections: [3, 3] } }))
			assert.equal(pstore.published?.active.length, 1)
			summary = SUMMARY_3
			replies = [verdicts([{ ruleId: 'r1', verdict: 'not_applicable', anchor: null }])]
			await judgeHandler.run(ctxFor('judge'))
			const p = pb.need('p-1')
			assert.equal(p.status, 'disabled')
			assert.deepEqual(p.trial?.cases, ['a', 'b', 'c1'])
			assert.deepEqual(p.trial.corrections, [3, 3, 3])
			assert.ok(pb.journal().some(e => e.kind === 'trial_failed'))
			assert.equal(pstore.published.active.length, 0)
		})

		it('пробный режим: не хуже прежнего → active, trial_passed; повтор кейса не удваивает', async () => {
			seed(state({ status: 'trial', rules: [], trial: { before: 3, cases: ['a'], corrections: [1] } }))
			summary = '# T\n### User corrections\n- одна (n 2)\n'
			await judgeHandler.run(ctxFor('judge'))
			assert.equal(pb.need('p-1').status, 'trial')
			assert.deepEqual(pb.need('p-1').trial?.cases, ['a', 'c1'])
			await judgeHandler.run(ctxFor('judge'))
			assert.deepEqual(pb.need('p-1').trial?.cases, ['a', 'c1'])
			pb.setStatus('p-1', 'trial', 'x')
			const p = pb.need('p-1')
			seed({ ...p, trial: { before: 3, cases: ['a', 'b'], corrections: [1, 1] } })
			await judgeHandler.run(ctxFor('judge'))
			assert.equal(pb.need('p-1').status, 'active')
			assert.ok(pb.journal().some(e => e.kind === 'trial_passed'))
		})
	})

	describe('улучшение', () => {
		const improvement = (o: Record<string, unknown>): string => `<result>${JSON.stringify(o)}</result>`
		const edit = { file: 'stages/01-research.md', before: 'findings listed', after: 'findings listed with sources', anchor: 'n 4' }

		it('правка с найденным before → новая версия и review с хэшем и baseVersion', async () => {
			seed(state())
			const v = pb.need('p-1').version
			replies = [improvement({ cause: 'gap', edits: [edit], candidates: [] })]
			await improveHandler.run(ctxFor('improve'))
			const p = pb.need('p-1')
			assert.equal(p.version, v + 1)
			assert.equal(p.stages[0]?.done, 'findings listed with sources')
			assert.ok(pstore.readFiles('p-1')['stages/01-research.md']?.includes('findings listed with sources'))
			assert.deepEqual(queued.map(q => [q.kind, q.subject]), [['review', 'p-1']])
			assert.deepEqual(queued[0]?.payload, { edits: [editHash(edit)], baseVersion: v })
			assert.ok(pb.journal().some(e => e.kind === 'version'))
			assert.match(agentPrompts[0] ?? '', /CASE: c1/)
			assert.match(agentPrompts[0] ?? '', /stages\/01-research\.md/)
		})

		it('отклонённая правка: хэш в промпте, повтор отбрасывается', async () => {
			seed(state({ rejectedEdits: [editHash(edit)] }))
			const v = pb.need('p-1').version
			replies = [improvement({ cause: 'error', edits: [edit], candidates: [] })]
			await improveHandler.run(ctxFor('improve'))
			assert.ok((agentPrompts[0] ?? '').includes(editHash(edit)))
			assert.equal(pb.need('p-1').version, v)
			assert.equal(queued.length, 0)
		})

		it('before не найден — правка отбрасывается; one_off — ничего', async () => {
			seed(state())
			const v = pb.need('p-1').version
			replies = [improvement({ cause: 'error', edits: [{ ...edit, before: 'нет такого текста' }], candidates: [] }), improvement({ cause: 'one_off', edits: [], candidates: [] })]
			await improveHandler.run(ctxFor('improve'))
			await improveHandler.run(ctxFor('improve'))
			assert.equal(pb.need('p-1').version, v)
			assert.equal(queued.length, 0)
		})

		it('кандидаты: похожий уходит в evidence существующего, новый — в rules как candidate', async () => {
			const text = 'всегда запускай линтер перед отправкой изменений на проверку'
			seed(state({ rules: [{ ...rule('rc', 'candidate', [{ caseId: 'c0', anchor: 'n 1' }]), text }] }))
			replies = [
				improvement({
					cause: 'gap',
					edits: [],
					candidates: [
						{ text, stage: null, evidence: [{ caseId: 'c1', anchor: 'n 4' }] },
						{ text: 'спрашивай пользователя о названии пакета до начала работы', stage: 1, evidence: [{ caseId: 'c1', anchor: 'n 5' }] },
					],
				}),
			]
			await improveHandler.run(ctxFor('improve'))
			const p = pb.need('p-1')
			assert.equal(p.rules.length, 2)
			assert.deepEqual(p.rules[0]?.evidence, [{ caseId: 'c0', anchor: 'n 1' }, { caseId: 'c1', anchor: 'n 4' }])
			assert.equal(p.rules[1]?.status, 'candidate')
			assert.equal(p.rules[1].stage, 1)
			assert.deepEqual(queued[0]?.payload?.['edits'], [])
		})
	})
})
