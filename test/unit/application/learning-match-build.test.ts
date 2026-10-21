/** Сопоставитель и сборщик плейбука: группы, дополнение плейбука, сборка (малая и большая), повторы. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import { buildHandler } from '../../../src/application/learning/build.handler'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import { matchHandler } from '../../../src/application/learning/match.handler'
import { BUILD_CHARS } from '../../../src/domain/learning-settings'
import type { RawEvent } from '../../../src/domain/learning.types'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

function repoRoot(): string {
	for (const start of [__dirname, process.cwd()]) {
		let dir = start
		for (;;) {
			if (existsSync(join(dir, 'learning', 'prompts', 'matcher.md'))) return dir
			const up = dirname(dir)
			if (up === dir) break
			dir = up
		}
	}
	throw new Error('корень репозитория не найден')
}
const prompt = (name: string): string => readFileSync(join(repoRoot(), 'learning', 'prompts', `${name}.md`), 'utf8')

const flush = async (): Promise<void> => {
	for (let i = 0; i < 40; i++) await new Promise<void>(r => setImmediate(r))
}

const SUMMARY = (title: string, corrections: string): string =>
	`# ${title}\n## Goal: review a merge request\n### Actions\n- read the merge request\n- write review comments\n### Sources\n- GitLab\n### User corrections\n${corrections}\n`

const baseCase = (id: string, i: number, over: Partial<CaseState> = {}): CaseState => ({
	id, title: `Review ${id}`, sessions: [id], status: 'ready', goals: [], events: 10, coveredUntil: 10,
	createdAt: new Date(T0 + i * 1000).toISOString(), updatedAt: new Date(T0 + i * 1000).toISOString(), closedAt: new Date(T0 + i * 1000).toISOString(),
	playbook: null, source: 'live', feedSeq: 0, transcripts: {}, nextN: 11, lastEventAt: 0, lastRunAt: 0, nessyCalls: false, hinted: [], ...over,
})

const events = (n: number, size = 20): RawEvent[] =>
	Array.from({ length: n }, (_v, i) => ({ n: i + 1, ts: T0, kind: 'user', from: 'you', to: null, text: `event ${i + 1} ${'x'.repeat(size)}`, ref: `r${i}` }))

const queuedJob = (kind: 'match' | 'build', subject: string, payload: Record<string, unknown>): JobState => ({
	id: `j-${subject}`, kind, caseId: '', subject, status: 'queued', attempts: 0, agentId: null, error: null, note: null, range: null,
	createdAt: '2026-10-01T10:00:00Z', startedAt: null, finishedAt: null, final: false, retryAt: null, payload,
})

const DRAFT = {
	title: 'Review merge request', description: 'Use when reviewing a merge request', taskType: 'review merge request', cases: [], heldOut: null,
	params: [], sources: ['GitLab'], files: [], behavior: [],
	stages: [{ n: 1, slug: 'read', title: 'Read', role: null, where: 'GitLab', produce: 'notes', done: 'read', gate: false, template: 'Read it' }],
	rules: [{ text: 'Run lint', stage: 1, evidence: [{ caseId: 'c1', anchor: 'n 1' }, { caseId: 'c2', anchor: 'n 2' }, { caseId: 'c3', anchor: 'n 3' }] }],
}
const result = (o: unknown): string => `Итог\n<result>\n${JSON.stringify(o)}\n</result>\nСтатус: ok`

describe('сопоставитель и сборщик плейбука', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let calls: Array<{ marker: string; name: string; prompt: string }>
	let reply: Record<string, (p: string) => string>
	let reviews: string[]
	const clock = { now: () => T0 + 3_600_000 }
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: () => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: req => {
			const marker = req.prompt.split('\n')[0]?.replace(/^#\s*/, '') ?? ''
			calls.push({ marker, name: req.name, prompt: req.prompt })
			const f = reply[marker]
			return Promise.resolve({ agentId: 'ag', ok: true, text: f ? f(req.prompt) : 'без результата' })
		},
	}
	const addCase = (id: string, i: number, over: Partial<CaseState> = {}, corrections = '- none', ev = events(12)): void => {
		store.cases.set(id, baseCase(id, i, { nextN: ev.length + 1, ...over }))
		store.summaries.set(id, SUMMARY(`Review ${id}`, corrections))
		store.raw.set(id, ev)
	}
	const group = (ids: string[]): Array<{ caseId: string; anchor: string }> => ids.map(caseId => ({ caseId, anchor: 'n 2–6' }))
	const run = async (jobs: JobState[]): Promise<LearningService> => {
		store.jobs = jobs
		const svc = new LearningService({ store, host, hub: new Hub(), clock, ids: { next: () => Math.random().toString(36).slice(2, 8) }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p', playbookStore: pstore })
		svc.load()
		svc.registerHandler(matchHandler)
		svc.registerHandler(buildHandler)
		svc.registerHandler({ kinds: ['review'], run: ctx => Promise.resolve(void reviews.push(ctx.job.subject)) })
		svc.start()
		await flush()
		return svc
	}
	const matchJob = (ids: string[], extra: Record<string, unknown> = {}): JobState => queuedJob('match', 'all', { caseIds: ids, ...extra })
	const kinds = (svc: LearningService): string[] => svc.view().jobs.map(j => `${j.kind}:${j.status}`)

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		calls = []
		reviews = []
		for (const n of ['matcher', 'case-analyst', 'playbook-builder']) store.prompts.set(n, prompt(n))
		reply = {
			'PLAYBOOK MATCHER': () => result({ groups: [{ task: 'review mr', taskType: 'review merge request', playbookId: null, cases: group(['c1', 'c2', 'c3']) }] }),
			'PLAYBOOK BUILDER': () => result(DRAFT),
			'CASE ANALYST': p => result({ caseId: /CASE: (\S+)/.exec(p)?.[1] ?? 'x', analysis: 'analysis n 2–6' }),
		}
	})

	it('три кейса одной задачи: match → build → draft с 2 кейсами сборки и heldOut → review поставлен', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		assert.deepEqual(calls.map(c => c.marker), ['PLAYBOOK MATCHER', 'PLAYBOOK BUILDER'])
		const p = svc.playbooks?.list().at(0)
		assert.ok(p)
		assert.equal(p.status, 'draft')
		assert.deepEqual(p.cases, ['c1', 'c2'])
		assert.equal(p.heldOut, 'c3')
		assert.deepEqual(reviews, [p.id])
		// доказательство с отложенного кейса не попадает в правила
		assert.deepEqual(p.rules.at(0)?.evidence.map(e => e.caseId), ['c1', 'c2'])
		// материалы builder'а — raw по якорю с запасом 3, без отложенного кейса
		const builder = calls[1]?.prompt ?? ''
		assert.match(builder, /\[1\] user you: event 1/)
		assert.ok(!builder.includes('CASE c3'))
		assert.ok(kinds(svc).every(k => k.endsWith(':done')), kinds(svc).join())
	})

	it('группа из двух кейсов: сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2'].entries()) addCase(id, i)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', playbookId: null, cases: group(['c1', 'c2']) }] })
		const svc = await run([matchJob(['c1', 'c2'])])
		assert.deepEqual(kinds(svc), ['match:done'])
		assert.equal(svc.playbooks?.list().length, 0)
	})

	it('кейс, названный сопоставителем, которого нет, выбрасывается: группа < 3 — сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2'].entries()) addCase(id, i)
		addCase('c3', 3, { status: 'collecting' })
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', playbookId: null, cases: group(['c1', 'c2', 'c3', 'ghost']) }] })
		const svc = await run([matchJob(['c1', 'c2'])])
		assert.deepEqual(kinds(svc), ['match:done'])
	})

	it('повтор той же группы: второй сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		assert.equal(svc.playbooks?.list().length, 1)
		const before = calls.length
		const again = new LearningService({ store, host, hub: new Hub(), clock, ids: { next: () => Math.random().toString(36).slice(2, 8) }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p', playbookStore: pstore })
		store.jobs = [matchJob(['c1', 'c2', 'c3'])]
		again.load()
		again.registerHandler(matchHandler)
		again.registerHandler(buildHandler)
		again.start()
		await flush()
		// агент-сопоставитель вызван снова, но build не поставлен и сборщик не запускался
		assert.deepEqual(calls.slice(before).map(c => c.marker), ['PLAYBOOK MATCHER'])
		assert.equal(again.playbooks?.list().length, 1)
		assert.ok(!again.view().jobs.some(j => j.kind === 'build'))
	})

	it('build над группой, у которой плейбук уже есть: без агентов', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		const p = samplePlaybook()
		const state: PlaybookState = { ...p, id: 'p-x', cases: ['c1', 'c2'], heldOut: 'c3', status: 'active', verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
		pstore.savePlaybook(state, {}, 'init')
		const svc = await run([queuedJob('build', 'g-xx', { task: 't', taskType: 'review', playbookId: null, cases: group(['c1', 'c2', 'c3']) })])
		assert.equal(calls.length, 0)
		assert.deepEqual(kinds(svc), ['build:done'])
		assert.equal(svc.playbooks?.list().length, 1)
	})

	it('группа к существующему плейбуку: кейс добавлен в cases, сборки нет; improve из match не ставится (его ставит судья)', async () => {
		for (const [i, id] of ['c1', 'c2'].entries()) addCase(id, i)
		addCase('c4', 4, { playbook: 'p-x@1' }, '- user asked to rerun lint')
		const p = samplePlaybook()
		const state: PlaybookState = { ...p, id: 'p-x', cases: ['c1', 'c2'], heldOut: null, status: 'active', verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
		pstore.savePlaybook(state, {}, 'init')
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', playbookId: 'p-x', cases: group(['c1', 'c4']) }] })
		const svc = await run([matchJob(['c4'])])
		assert.deepEqual(svc.playbooks?.get('p-x')?.cases, ['c1', 'c2', 'c4'])
		assert.ok(!calls.some(c => c.marker === 'PLAYBOOK BUILDER'))
		assert.ok(!svc.view().jobs.some(j => j.kind === 'improve'))
	})

	it('большие материалы: case-analyst на каждый кейс сборки, затем один playbook-builder по разборам', async () => {
		// событие режется до 4000 знаков: чтобы набрать объём, нужно много событий
		const many = events(Math.ceil((BUILD_CHARS / 3500) * 1.2), 3900)
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i, {}, '- none', many)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review merge request', playbookId: null, cases: [{ caseId: 'c1', anchor: `n 1–${many.length}` }, { caseId: 'c2', anchor: `n 1–${many.length}` }, { caseId: 'c3', anchor: 'n 1–3' }] }] })
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		const markers = calls.map(c => c.marker)
		assert.equal(markers.filter(m => m === 'CASE ANALYST').length >= 2, true)
		assert.ok(!markers.slice(0, -1).includes('PLAYBOOK BUILDER'))
		assert.equal(markers.filter(m => m === 'PLAYBOOK BUILDER').length, 1)
		assert.ok((calls.find(c => c.marker === 'PLAYBOOK BUILDER')?.prompt ?? '').includes('analysis n 2–6'))
		assert.equal(svc.playbooks?.list().length, 1)
	})

	it('бэкфилл 5 кейсов: match ждёт, пока пачка не станет готовой', async () => {
		const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
		for (const [i, id] of ids.entries()) addCase(id, i, { status: id === 'c5' ? 'closing' : 'ready' })
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [] })
		const svc = await run([matchJob(ids, { after: ids })])
		// c5 ещё не готов — задание ждёт
		assert.equal(calls.length, 0)
		assert.deepEqual(kinds(svc), ['match:queued'])
	})

	it('бэкфилл 5 готовых кейсов: один match и один вызов сопоставителя со всеми', async () => {
		const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
		for (const [i, id] of ids.entries()) addCase(id, i)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [] })
		const svc = await run([matchJob(ids, { after: ids })])
		assert.deepEqual(calls.map(c => c.marker), ['PLAYBOOK MATCHER'])
		for (const id of ids) assert.ok((calls[0]?.prompt ?? '').includes(`CASE ${id}`))
		assert.deepEqual(kinds(svc), ['match:done'])
	})

	it('ответ сопоставителя без <result>: задание с повтором, плейбуков нет', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		delete reply['PLAYBOOK MATCHER']
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		const j = svc.view().jobs[0]
		assert.equal(j?.status, 'queued')
		assert.equal(j.attempts, 1)
		assert.equal(svc.playbooks?.list().length, 0)
	})
})
