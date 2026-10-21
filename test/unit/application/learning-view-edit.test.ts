/** Просмотр и правка блоками (этап 3): задание с ответами, raw, summary, остановка сборщика, impact, PATCH плейбука. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, PlaybookView, RawEvent } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const flush = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r))
}
const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[]}</meta>'

const baseCase = (id: string, over: Partial<CaseState> = {}): CaseState => ({
	id, title: 'Case', sessions: [id], status: 'collecting', goals: [], events: 10, coveredUntil: 0,
	createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), closedAt: null,
	playbook: null, source: 'live', feedSeq: 5, transcripts: {}, nextN: 11, lastEventAt: 0, lastRunAt: 0, nessyCalls: false, hinted: [],
	...over,
})
const raw = (n: number): RawEvent => ({ n, ts: T0 + n, kind: 'user', from: 'you', to: 'a1', text: `событие ${n}`, ref: `m${n}` })

describe('LearningService: просмотр и правка блоками', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let events: HubEvent[]
	let hold: Promise<void> | null
	let cancelled: string[]
	const host: LearningHost = {
		sessions: () => [], messagesSince: () => [], lastSeq: () => 0, sessionOfMessage: () => null, isBusy: () => false,
		cancelAgent: id => {
			cancelled.push(id)
			return Promise.resolve()
		},
		runAgent: async req => {
			req.onSpawn?.('ag-live')
			if (hold) await hold
			return { agentId: 'ag-live', ok: true, text: GOOD }
		},
	}
	const make = (): LearningService => {
		const hub = new Hub()
		hub.subscribe(e => events.push(e))
		const svc = new LearningService({ store, host, hub, clock: { now: () => T0 + 3_600_000 }, ids: { next: () => Math.random().toString(36).slice(2, 10) }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p', playbookStore: pstore })
		svc.load()
		svc.start()
		return svc
	}
	const seedPlaybook = (over: Partial<PlaybookState> = {}): PlaybookState => {
		const p: PlaybookState = { ...samplePlaybook(), verdicts: {}, rejectedEdits: [], reviewAttempts: 0, ...over }
		pstore.snapshots.set(p.id, [{ state: p, files: {}, ts: '2026-10-01T00:00:00Z', message: 'init' }])
		return p
	}
	const job = (over: Partial<JobState>): JobState => ({
		id: 'j-1', kind: 'collect', caseId: 'c-1', subject: 'c-1', status: 'done', attempts: 0, agentId: null, error: null, note: null, range: null,
		createdAt: new Date(T0).toISOString(), startedAt: null, finishedAt: null, final: false, retryAt: null, payload: null, ...over,
	})

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		store.prompts.set('session-collector', '{{mode}}|{{range}}|{{summary}}')
		events = []
		hold = null
		cancelled = []
	})

	it('jobDetail: ответы по порядку k (10 после 2), чужие задания не попадают; нет задания — 404', () => {
		store.cases.set('c-1', baseCase('c-1', { status: 'ready' }))
		store.jobs = [job({ id: 'j-1' })]
		store.runs.set('c-1/j-1-2', 'второй')
		store.runs.set('c-1/j-1-10', 'десятый')
		store.runs.set('c-1/j-1-1', 'первый')
		store.runs.set('c-1/j-2-1', 'чужой')
		const svc = make()
		const d = svc.jobDetail('j-1')
		assert.equal(d.job.id, 'j-1')
		assert.deepEqual(d.runs, [{ name: 'j-1-1', text: 'первый' }, { name: 'j-1-2', text: 'второй' }, { name: 'j-1-10', text: 'десятый' }])
		assert.deepEqual(svc.jobDetail('j-1').job, d.job)
		assert.throws(() => svc.jobDetail('j-x'), { code: 'no_job', status: 404 })
	})

	it('caseRaw: диапазон включительно, без to — до конца, не больше 500; нет кейса — 404', () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.raw.set('c-1', Array.from({ length: 600 }, (_, i) => raw(i + 1)))
		store.cases.set('c-1', baseCase('c-1', { nextN: 601 }))
		const svc = make()
		assert.deepEqual(svc.caseRaw('c-1', 3, 5).map(e => e.n), [3, 4, 5])
		assert.equal(svc.caseRaw('c-1', 0).length, 500)
		assert.equal(svc.caseRaw('c-1', 590).length, 11)
		assert.throws(() => svc.caseRaw('c-x', 0), { code: 'no_case', status: 404 })
	})

	it('setCaseSummary: пишет summary.md, курсор цел; running-задание — 409 case_busy; нет кейса — 404', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.summaries.set('c-1', '# Old')
		store.raw.set('c-1', [raw(1)])
		const svc = make()
		const before = JSON.stringify(svc.getCase('c-1'))
		svc.setCaseSummary('c-1', '# New')
		assert.equal(store.summaries.get('c-1'), '# New')
		assert.equal(JSON.stringify(svc.getCase('c-1')), before)
		assert.throws(() => svc.setCaseSummary('c-x', 'x'), { code: 'no_case', status: 404 })
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.runNow('c-1')
		await flush()
		assert.throws(() => svc.setCaseSummary('c-1', 'x'), { code: 'case_busy', status: 409 })
		release()
		await flush()
		svc.setCaseSummary('c-1', '# Again')
		assert.equal(store.summaries.get('c-1'), '# Again')
	})

	it('stopCollector: running прерывается (агент отменён, итог не пишется), кейс с описанием → ready', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.raw.set('c-1', [raw(1)])
		store.summaries.set('c-1', '# Есть описание')
		const svc = make()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.runNow('c-1')
		await flush()
		const running = svc.view().jobs.find(j => j.status === 'running')
		assert.equal(running?.agentId, 'ag-live')
		svc.stopCollector('c-1')
		assert.deepEqual(cancelled, ['ag-live'])
		assert.equal(svc.getCase('c-1').status, 'ready')
		assert.equal(svc.view().jobs.find(j => j.id === running.id)?.status, 'done')
		release()
		await flush()
		// поздний ответ агента игнорируется: описание прежнее, курсор не двигался
		assert.equal(store.summaries.get('c-1'), '# Есть описание')
		assert.equal(svc.getCase('c-1').coveredUntil, 0)
		assert.equal(svc.getCase('c-1').status, 'ready')
	})

	it('stopCollector: без описания кейс удаляется, queued снимаются; без заданий сборки — ничего', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.cases.set('c-2', baseCase('c-2', { status: 'ready' }))
		store.raw.set('c-1', [raw(1)])
		const svc = make()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.runNow('c-1')
		await flush()
		svc.stopCollector('c-1')
		assert.equal(svc.view().cases.some(c => c.id === 'c-1'), false)
		assert.ok(events.some(e => e.t === 'learning_case_removed' && e.id === 'c-1'))
		release()
		await flush()
		svc.stopCollector('c-2')
		assert.equal(svc.getCase('c-2').status, 'ready')
		assert.throws(() => svc.stopCollector('c-x'), { code: 'no_case', status: 404 })
	})

	it('caseImpact: единственное доказательство → evidenceLeft 0, с другим кейсом → 1; архивные и чужие не считаются', () => {
		store.cases.set('c1', baseCase('c1', { status: 'ready' }))
		store.cases.set('c2', baseCase('c2', { status: 'ready' }))
		seedPlaybook()
		const svc = make()
		const impact = svc.caseImpact('c1')
		// r1: c1 + c2 → 1; r2: только c1 → 0
		assert.deepEqual(impact.rules.map(r => [r.ruleId, r.evidenceLeft]), [['r1', 1], ['r2', 0]])
		assert.equal(impact.rules[0]?.playbookId, 'p-1')
		assert.equal(impact.rules[0].text, 'Run lint')
		// c2 — доказательство только r1, и там остаётся c1
		assert.deepEqual(svc.caseImpact('c2').rules.map(r => [r.ruleId, r.evidenceLeft]), [['r1', 1]])
		// неизвестный кейс среди доказательств не считается «оставшимся»
		assert.throws(() => svc.caseImpact('c-x'), { code: 'no_case', status: 404 })
	})

	it('patchPlaybook: удаление шага — новая версия без файла этапа, n по порядку, журнал edit с версией', () => {
		store.cases.set('c1', baseCase('c1', { status: 'ready' }))
		store.cases.set('c2', baseCase('c2', { status: 'ready' }))
		seedPlaybook()
		const svc = make()
		const view = svc.patchPlaybook('p-1', { stages: [{ n: 9, slug: 'implement', title: 'Implement', role: null, where: 'repo', produce: 'a diff', done: 'tests pass', gate: true, template: 'Code' }] })
		assert.equal(view.version, 2)
		assert.deepEqual(view.stages.map(s => [s.n, s.slug]), [[1, 'implement']])
		const files = Object.keys(pstore.snapshots.get('p-1')?.at(-1)?.files ?? {})
		assert.ok(files.includes('stages/01-implement.md'))
		assert.ok(!files.some(f => f.includes('research')))
		const entry = pstore.journal.at(-1)
		assert.equal(entry?.kind, 'edit')
		assert.equal(entry.revertible, true)
		assert.equal((JSON.parse(entry.report ?? '{}') as { version: number }).version, 2)
		assert.ok(events.some(e => e.t === 'learning_playbook'))
	})

	it('patchPlaybook: description без «Use when» — 400 lint; нет плейбука — 404', () => {
		seedPlaybook()
		const svc = make()
		assert.throws(() => svc.patchPlaybook('p-1', { description: 'Reviews things' }), { code: 'lint', status: 400 })
		assert.equal(svc.playbooks?.get('p-1')?.version, 1)
		assert.throws(() => svc.patchPlaybook('p-x', { title: 'x' }), { code: 'no_playbook', status: 404 })
	})

	it('patchPlaybook: правила — новые candidate с id, отсутствующие → archived (не удаляются), правка текста сохраняет счётчики', () => {
		store.cases.set('c1', baseCase('c1', { status: 'ready' }))
		store.cases.set('c2', baseCase('c2', { status: 'ready' }))
		seedPlaybook()
		const svc = make()
		const view = svc.patchPlaybook('p-1', { rules: [{ id: 'r1', text: 'Run lint and tests', stage: 1 }, { text: 'Brand new', stage: null }] })
		const byText = (t: string): PlaybookView['rules'][number] | undefined => view.rules.find(r => r.text === t)
		const r1 = view.rules.find(r => r.id === 'r1')
		assert.equal(r1?.text, 'Run lint and tests')
		assert.equal(r1.stage, 1)
		assert.equal(r1.up, 3)
		assert.equal(r1.status, 'active')
		const fresh = byText('Brand new')
		assert.match(fresh?.id ?? '', /^r-[0-9a-f]{6}$/)
		assert.equal(fresh?.status, 'candidate')
		assert.equal(view.rules.find(r => r.id === 'r2')?.status, 'archived')
		assert.equal(view.rules.length, 3)
		assert.throws(() => svc.patchPlaybook('p-1', { rules: [{ id: 'r-nope', text: 'x', stage: null }] }), { code: 'bad_request', status: 400 })
	})

	it('patchPlaybook: по плейбуку идёт задание — 409 playbook_busy', async () => {
		seedPlaybook({ status: 'draft' })
		for (const id of ['c1', 'c2', 'c3']) store.cases.set(id, baseCase(id, { status: 'ready' }))
		const svc = make()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.requestReview('p-1')
		await flush()
		assert.throws(() => svc.patchPlaybook('p-1', { title: 'New title' }), { code: 'playbook_busy', status: 409 })
		release()
	})
})
