/** Свёртка влитых целей: цель уходит из описания, пустой кейс удаляется, сырые события — в скрытый архив. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import type { RawEvent } from '../../../src/domain/learning.types'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const DAY = 86_400_000
const flush = async (): Promise<void> => {
	for (let i = 0; i < 40; i++) await new Promise<void>(r => setImmediate(r))
}

const TWO =
	'# Session\n## Goal: Review MR (type: review)\n### Plan\n- read\n### Actions\n- read (n 1–2)\n## Goal: Write changelog (type: docs)\n### Plan\n- write\n### Actions\n- wrote (n 3–4)\n'
const ONE = '# Session\n## Goal: Review MR (type: review)\n### Plan\n- read\n### Actions\n- read (n 1–2)\n'

const caseState = (id: string): CaseState => ({
	id,
	title: `Session ${id}`,
	sessions: [id],
	status: 'ready',
	goals: [
		{ title: 'Review MR', type: 'review' },
		{ title: 'Write changelog', type: 'docs' },
	],
	events: 4,
	coveredUntil: 4,
	createdAt: new Date(T0).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	closedAt: new Date(T0).toISOString(),
	playbook: null,
	source: 'live',
	feedSeq: 0,
	transcripts: {},
	nextN: 5,
	lastEventAt: 0,
	lastRunAt: 0,
	nessyCalls: false,
	hinted: [],
})
const events = (): RawEvent[] =>
	Array.from({ length: 4 }, (_v, i) => ({ n: i + 1, ts: T0, kind: 'user', from: 'you', to: null, text: `e${i + 1}`, ref: `r${i}` }))
const foldJob = (caseId: string, goal: string, playbookId = 'p-x'): JobState => ({
	id: `j-${caseId}-${goal}`,
	kind: 'fold',
	caseId,
	subject: `fold:${caseId}:${goal}`,
	status: 'queued',
	attempts: 0,
	agentId: null,
	error: null,
	note: null,
	range: null,
	createdAt: '2026-10-01T10:00:00Z',
	startedAt: null,
	finishedAt: null,
	final: false,
	payload: { playbookId, caseId, goal },
})

describe('fold: свёртка влитой цели', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let now: number
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: () => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: () => Promise.reject(new Error('агент не нужен')),
	}
	const addCase = (id: string, summary: string): void => {
		store.cases.set(id, caseState(id))
		store.summaries.set(id, summary)
		store.raw.set(id, events())
	}
	const addPlaybook = (status: PlaybookState['status'] = 'trial', folds: PlaybookState['folds'] = []): void => {
		pstore.savePlaybook(
			{ ...samplePlaybook(), id: 'p-x', status, cases: ['c1'], heldOut: null, verdicts: {}, rejectedEdits: [], reviewAttempts: 0, pendingEdits: [], folds },
			{},
			'init',
		)
	}
	const run = async (jobs: JobState[]): Promise<LearningService> => {
		store.jobs = jobs
		const svc = new LearningService({
			store,
			host,
			hub: new Hub(),
			clock: { now: () => now },
			ids: { next: () => Math.random().toString(36).slice(2, 8) },
			defaultOn: true,
			claudeProjectsDir: '/p',
			playbookStore: pstore,
		})
		svc.load()
		svc.start()
		await flush()
		return svc
	}

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		now = T0 + 3_600_000
	})

	it('кейс с двумя целями, влита одна: цель ушла из описания, кейс и события остаются, плейбук «основан на сессии»', async () => {
		addCase('c1', TWO)
		addPlaybook()
		const svc = await run([foldJob('c1', 'Write changelog')])
		const c = svc.getCase('c1')
		assert.deepEqual(
			c.goals.map(g => g.title),
			['Review MR'],
		)
		assert.equal(c.foldedGoals, 1)
		assert.ok(!store.readSummary('c1').includes('Write changelog'))
		assert.ok(store.readSummary('c1').includes('Review MR'))
		assert.equal(store.raw.get('c1')?.length, 4)
		assert.equal(store.archive.size, 0)
		assert.deepEqual(svc.playbooks?.get('p-x')?.basedOn, [{ session: 'Session c1', date: '2026-10-01' }])
		assert.ok(svc.view().jobs.every(j => j.status === 'done'))
	})

	it('последняя цель: кейс удалён без надгробия, raw переехал в архив, запись в журнале', async () => {
		addCase('c1', ONE)
		addPlaybook()
		const svc = await run([foldJob('c1', 'Review MR')])
		assert.equal(svc.view().cases.length, 0)
		assert.ok(!store.cases.has('c1'))
		assert.equal(store.archive.get('c1')?.raw.length, 4)
		assert.ok(!(store.meta?.removed ?? []).includes('c1'))
		assert.ok(svc.journal().some(e => e.kind === 'log' && /Цель «Review MR» из сессии «Session c1» влита в плейбук .*сессия удалена/.test(e.summary)))
	})

	it('archiveDays = 0: сырые события не хранятся', async () => {
		store.settingsRaw = { archiveDays: 0 }
		store.mtimeMs = 1
		addCase('c1', ONE)
		addPlaybook()
		await run([foldJob('c1', 'Review MR')])
		assert.ok(!store.cases.has('c1'))
		assert.equal(store.archive.size, 0)
	})

	it('чистка архива по archiveDays при старте: старше срока стирается, свежее остаётся', async () => {
		store.archive.set('old', { raw: [], at: now - 40 * DAY })
		store.archive.set('new', { raw: [], at: now - 5 * DAY })
		await run([])
		assert.deepEqual([...store.archive.keys()], ['new'])
	})

	it('плейбук вышел в trial: на каждого члена ставится fold, пустой кейс сворачивается', async () => {
		addCase('c1', ONE)
		addPlaybook('review', [{ caseId: 'c1', goal: 'Review MR' }])
		const svc = await run([])
		assert.ok(store.cases.has('c1'))
		svc.approvePlaybook('p-x')
		await flush()
		assert.ok(!store.cases.has('c1'))
		assert.equal(svc.playbooks?.get('p-x')?.folds?.length, 0)
		assert.equal(svc.playbooks.get('p-x')?.status, 'trial')
		assert.ok(svc.view().jobs.some(j => j.kind === 'fold' && j.status === 'done'))
	})

	it('плейбук ещё не в работе: цели ждут, fold не ставится', async () => {
		addCase('c1', ONE)
		addPlaybook('draft', [{ caseId: 'c1', goal: 'Review MR' }])
		const svc = await run([])
		assert.ok(!svc.view().jobs.some(j => j.kind === 'fold'))
		assert.equal(svc.playbooks?.get('p-x')?.folds?.length, 1)
	})

	it('цель уже убрана из описания или плейбук удалён: кейс не трогается', async () => {
		addCase('c1', ONE)
		const svc = await run([foldJob('c1', 'Review MR', 'p-gone')])
		assert.ok(store.cases.has('c1'))
		assert.equal(svc.view().jobs[0]?.status, 'done')
	})
})
