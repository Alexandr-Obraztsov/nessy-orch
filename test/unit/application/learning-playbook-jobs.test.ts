/** Обработчики заданий: неизвестный вид, onCaseReady (judge, match, пачка бэкфилла), skill → case.playbook. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { onCaseReady } from '../../../src/application/learning/case-ready'
import { JobQueue } from '../../../src/application/learning/job-queue'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { drainReads } from '../../support/read-blocks'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'
import type { PlaybookState } from '../../../src/application/learning/learning.types'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string): SessionView => ({
	id,
	title: id,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0 + 60_000).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
	transcriptPath: `/p/${id}.jsonl`,
})

let seq = 0
const msg = (sessionId: string): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text: `текст ${seq}`, hops: 0, session: sessionId }
}

const skillLine = (name: string): string =>
	JSON.stringify({ type: 'assistant', uuid: 'u-skill', timestamp: new Date(T0 + 5000).toISOString(), message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: name } }] } }) + '\n'

const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[{"title":"g","type":"t"}]}</meta>'

const flush = async (): Promise<void> => {
	for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r))
}

describe('обработчики заданий и onCaseReady', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let sessions: SessionView[]
	let feed: Message[]
	const clock = { t: T0 + 60_000, now: () => clock.t }
	let current: LearningService | null = null
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: () => {
			drainReads(current)
			return Promise.resolve({ agentId: 'ag', ok: true, text: GOOD })
		},
	}
	const make = (withPlaybooks: boolean): LearningService => {
		const s = new LearningService({ store, host, hub: new Hub(), clock, ids: { next: () => `id${Math.random().toString(36).slice(2, 8)}` }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p', playbookStore: withPlaybooks ? pstore : undefined })
		current = s
		s.load()
		return s
	}

	beforeEach(() => {
		seq = 0
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		store.prompts.set('session-collector', '{{mode}}')
		sessions = [session('s1'), session('s2'), session('s3')]
		feed = []
		clock.t = T0 + 60_000
	})

	it('задание неизвестного вида: не error, а повтор с паузой и ошибкой «нет обработчика»', async () => {
		const svc = make(false)
		store.jobs = [
			{ id: 'j1', kind: 'match', caseId: '', subject: 'all', status: 'queued', attempts: 0, agentId: null, error: null, note: null, range: null, createdAt: '2026-10-01T10:00:00Z', startedAt: null, finishedAt: null, final: false, retryAt: null, payload: null },
		]
		svc.load()
		svc.start()
		await flush()
		const j = svc.view().jobs[0]
		assert.equal(j?.status, 'queued')
		assert.match(j.error ?? '', /нет обработчика/)
		await svc.stop()
	})

	it('без playbookStore: кейс готов, match не ставится, playbooks = []', async () => {
		const svc = make(false)
		feed = [msg('s1')]
		svc.runNow('s1')
		await flush()
		assert.equal(svc.getCase('c-s1').status, 'ready')
		assert.deepEqual(svc.view().jobs.map(j => j.kind), ['close'])
		assert.deepEqual(svc.view().playbooks, [])
		assert.equal(svc.playbooks, null)
	})

	it('кейс с playbook: judge (subject = judge:<кейс>) и match; без playbook — только match', async () => {
		const svc = make(true)
		const ran: string[] = []
		svc.registerHandler({ kinds: ['judge', 'match'], run: ctx => Promise.resolve(void ran.push(`${ctx.job.kind}:${ctx.job.subject}`)) })
		store.files.set('/p/s1.jsonl', skillLine('nessy-playbooks:p-aff'))
		feed = [msg('s1'), msg('s2')]
		svc.runNow('s1')
		await flush()
		svc.runNow('s2')
		await flush()
		assert.equal(svc.getCase('c-s1').playbook, 'p-aff@0')
		assert.equal(svc.getCase('c-s2').playbook, null)
		assert.ok(ran.includes('judge:judge:c-s1'))
		assert.ok(!ran.includes('judge:judge:c-s2'))
		assert.equal(ran.filter(r => r.startsWith('match')).length, 2)
	})

	it('skill nessy-playbooks:<id> → playbook = <id>@<версия> (первое за кейс)', () => {
		const svc = make(true)
		const p = samplePlaybook()
		const state: PlaybookState = { ...p, id: 'p-aff', status: 'active', version: 1, verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
		pstore.savePlaybook(state, {}, 'init')
		svc.load()
		store.files.set('/p/s1.jsonl', skillLine('nessy-playbooks:p-aff') + skillLine('nessy-playbooks:p-other'))
		feed = [msg('s1')]
		svc.tick()
		assert.equal(svc.getCase('c-s1').playbook, 'p-aff@1')
		assert.equal(svc.view().playbooks.length, 1)
	})

	it('бэкфилл пачки из 3: один match с after = вся пачка и caseIds = все три', async () => {
		const svc = make(true)
		const payloads: Array<Record<string, unknown> | null> = []
		svc.registerHandler({ kinds: ['match'], run: ctx => Promise.resolve(void payloads.push(ctx.job.payload)) })
		feed = [msg('s1'), msg('s2'), msg('s3')]
		svc.backfill(['s1', 's2', 's3'])
		// пачка лежит в meta.json (переживает рестарт) и стирается, когда кейс стал ready
		assert.deepEqual(Object.keys(store.meta?.batches ?? {}).sort(), ['c-s1', 'c-s2', 'c-s3'])
		await flush()
		assert.deepEqual(Object.keys(store.meta?.batches ?? {}), [])
		assert.equal(payloads.length, 1)
		const sorted = (v: unknown): unknown[] => (Array.isArray(v) ? v.map(String).sort() : [])
		assert.deepEqual(sorted(payloads[0]?.['caseIds']), ['c-s1', 'c-s2', 'c-s3'])
		assert.deepEqual(sorted(payloads[0]?.['after']), ['c-s1', 'c-s2', 'c-s3'])
		assert.ok(svc.view().cases.every(c => c.status === 'ready'))
	})
})

describe('onCaseReady (без насоса)', () => {
	const baseCase: CaseState = {
		id: '', title: null, sessions: [], status: 'ready', goals: [], events: 0, coveredUntil: 0, createdAt: '', updatedAt: '', closedAt: null, playbook: null, source: 'live',
		feedSeq: 0, transcripts: {}, nextN: 1, lastEventAt: 0, lastRunAt: 0, nessyCalls: false, hinted: [],
	}
	const caseWith = (id: string, playbook: string | null): CaseState => ({ ...baseCase, id, playbook })
	let queue: JobQueue
	let cases: Map<string, CaseState>
	let batches: Map<string, string[]>
	const host = () => ({
		cases: { get: (id: string) => cases.get(id) ?? null },
		enqueue: (k: Parameters<JobQueue['enqueue']>[0], s: string, o?: Parameters<JobQueue['enqueue']>[2]) => void queue.enqueue(k, s, o),
		batch: (id: string) => batches.get(id) ?? null,
	})

	beforeEach(() => {
		queue = new JobQueue({ ids: { next: () => Math.random().toString(36).slice(2, 8) }, now: () => 1 })
		cases = new Map([caseWith('c1', null), caseWith('c2', 'p-x@1'), caseWith('c3', null)].map(c => [c.id, c]))
		batches = new Map()
	})

	it('judge ставится только при playbook', () => {
		onCaseReady(host(), 'c1')
		assert.deepEqual(queue.list().map(j => j.kind), ['match'])
		onCaseReady(host(), 'c2')
		const judge = queue.list().find(j => j.kind === 'judge')
		assert.equal(judge?.subject, 'judge:c2')
		assert.equal(judge.caseId, 'c2')
		// замок плейбука читает payload.playbookId: id до `@`
		assert.equal(judge.payload?.['playbookId'], 'p-x')
	})

	it('два кейса подряд → один match с двумя caseIds', () => {
		onCaseReady(host(), 'c1')
		onCaseReady(host(), 'c3')
		onCaseReady(host(), 'c1')
		const matches = queue.list().filter(j => j.kind === 'match')
		assert.equal(matches.length, 1)
		assert.equal(matches[0]?.subject, 'all')
		assert.deepEqual(matches[0].payload, { caseIds: ['c1', 'c3'] })
	})

	it('пачка бэкфилла: after = все кейсы пачки', () => {
		const batch = ['c1', 'c2', 'c3']
		for (const id of batch) batches.set(id, batch)
		onCaseReady(host(), 'c1')
		onCaseReady(host(), 'c3')
		const matches = queue.list().filter(j => j.kind === 'match')
		assert.equal(matches.length, 1)
		assert.deepEqual(matches[0]?.payload, { caseIds: ['c1', 'c3'], after: batch })
	})
})
