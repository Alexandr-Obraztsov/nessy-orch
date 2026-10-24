/** Сопоставитель и сборщик плейбука: группы, дополнение плейбука, сборка (малая и большая), повторы. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import { buildHandler } from '../../../src/application/learning/build.handler'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import { absorbHandler } from '../../../src/application/learning/absorb.handler'
import { OVERVIEW_CHARS, OVERVIEW_MIN_CASES, matchHandler, overviewCards } from '../../../src/application/learning/match.handler'
import { verifyHandler } from '../../../src/application/learning/verify.handler'
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

const queuedJob = (kind: 'match' | 'build' | 'verify', subject: string, payload: Record<string, unknown>): JobState => ({
	id: `j-${subject}`, kind, caseId: '', subject, status: 'queued', attempts: 0, agentId: null, error: null, note: null, range: null,
	createdAt: '2026-10-01T10:00:00Z', startedAt: null, finishedAt: null, final: false, payload,
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
	const GOAL = 'review a merge request'
	const members = (ids: string[], anchors = ['n 2–6']): Array<{ caseId: string; goal: string; anchors: string[] }> => ids.map(caseId => ({ caseId, goal: GOAL, anchors }))
	const run = async (jobs: JobState[]): Promise<LearningService> => {
		store.jobs = jobs
		const svc = new LearningService({ store, host, hub: new Hub(), clock, ids: { next: () => Math.random().toString(36).slice(2, 8) }, defaultOn: true, claudeProjectsDir: '/p', playbookStore: pstore })
		svc.load()
		svc.registerHandler(matchHandler)
		svc.registerHandler(verifyHandler)
		svc.registerHandler(absorbHandler)
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
		for (const n of ['matcher', 'group-verifier', 'case-analyst', 'playbook-builder']) store.prompts.set(n, prompt(n))
		reply = {
			'PLAYBOOK MATCHER': () => result({ groups: [{ task: 'review mr', taskType: 'review merge request', action: 'new_playbook', playbookId: null, members: members(['c1', 'c2', 'c3']), reason: 'same' }] }),
			'GROUP VERIFIER': () => result({ verdict: 'confirm', reason: 'same task' }),
			'PLAYBOOK BUILDER': () => result(DRAFT),
			'CASE ANALYST': p => result({ caseId: /CASE: (\S+)/.exec(p)?.[1] ?? 'x', analysis: 'analysis n 2–6' }),
		}
	})

	it('три кейса одной задачи: match → build → draft с 2 кейсами сборки и heldOut → review поставлен', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		assert.deepEqual(calls.map(c => c.marker), ['PLAYBOOK MATCHER', 'GROUP VERIFIER', 'PLAYBOOK BUILDER'])
		const p = svc.playbooks?.list().at(0)
		assert.ok(p)
		assert.equal(p.status, 'draft')
		assert.deepEqual(p.cases, ['c1', 'c2'])
		assert.equal(p.heldOut, 'c3')
		assert.deepEqual(reviews, [p.id])
		// цели всех трёх сессий ждут свёртки, пока плейбук не вышел в trial
		assert.deepEqual(svc.playbooks?.get(p.id)?.folds?.map(f => f.caseId).sort(), ['c1', 'c2', 'c3'])
		// доказательство с отложенного кейса не попадает в правила
		assert.deepEqual(p.rules.at(0)?.evidence.map(e => e.caseId), ['c1', 'c2'])
		// материалы builder'а — raw по якорю с запасом 3, без отложенного кейса
		const builder = calls[2]?.prompt ?? ''
		assert.match(builder, /\[1\] user you: event 1/)
		assert.ok(!builder.includes('CASE c3'))
		assert.ok(kinds(svc).every(k => k.endsWith(':done')), kinds(svc).join())
	})

	it('группа из двух кейсов: сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2'].entries()) addCase(id, i)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', action: 'new_playbook', playbookId: null, members: members(['c1', 'c2']), reason: '' }] })
		const svc = await run([matchJob(['c1', 'c2'])])
		assert.deepEqual(kinds(svc), ['match:done'])
		assert.equal(svc.playbooks?.list().length, 0)
	})

	it('кейс, названный сопоставителем, которого нет, выбрасывается: группа < 3 — сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2'].entries()) addCase(id, i)
		addCase('c3', 3, { status: 'collecting' })
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', action: 'new_playbook', playbookId: null, members: members(['c1', 'c2', 'c3', 'ghost']), reason: '' }] })
		const svc = await run([matchJob(['c1', 'c2'])])
		assert.deepEqual(kinds(svc), ['match:done'])
	})

	it('повтор той же группы: второй сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		assert.equal(svc.playbooks?.list().length, 1)
		const before = calls.length
		const again = new LearningService({ store, host, hub: new Hub(), clock, ids: { next: () => Math.random().toString(36).slice(2, 8) }, defaultOn: true, claudeProjectsDir: '/p', playbookStore: pstore })
		store.jobs = [matchJob(['c1', 'c2', 'c3'])]
		again.load()
		again.registerHandler(matchHandler)
		again.registerHandler(buildHandler)
		again.start()
		await flush()
		// агент-сопоставитель вызван снова, но проверка и сборка не поставлены
		assert.deepEqual(calls.slice(before).map(c => c.marker), ['PLAYBOOK MATCHER'])
		assert.equal(again.playbooks?.list().length, 1)
		assert.ok(!again.view().jobs.some(j => j.kind === 'build' || j.kind === 'verify'))
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

	it('add_to_playbook: проверка, затем вливание — билдер видит существующий документ, кейс в cases, цель ждёт свёртки, ревью правки; improve не ставится', async () => {
		for (const [i, id] of ['c1', 'c2'].entries()) addCase(id, i)
		addCase('c4', 4, { playbook: 'p-x@1' }, '- user asked to rerun lint')
		const p = samplePlaybook()
		const state: PlaybookState = { ...p, id: 'p-x', cases: ['c1', 'c2'], heldOut: null, status: 'active', verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
		pstore.savePlaybook(state, {}, 'init')
		reply['PLAYBOOK BUILDER'] = () => result({ ...DRAFT, rules: [{ id: 'r1', text: 'Run lint and tests', stage: 1, evidence: [{ caseId: 'c4', anchor: 'n 2' }] }] })
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', action: 'add_to_playbook', playbookId: 'p-x', members: members(['c4']), reason: '' }] })
		const svc = await run([matchJob(['c4'])])
		assert.deepEqual(svc.playbooks?.get('p-x')?.cases, ['c1', 'c2', 'c4'])
		assert.deepEqual(calls.map(c => c.marker), ['PLAYBOOK MATCHER', 'GROUP VERIFIER', 'PLAYBOOK BUILDER'])
		assert.match(calls[2]?.prompt ?? '', /Implement aff package/)
		assert.deepEqual(svc.playbooks.get('p-x')?.folds?.map(f => f.caseId), ['c4'])
		assert.deepEqual(reviews, ['p-x'])
		assert.ok(!svc.view().jobs.some(j => j.kind === 'improve'))
	})

	it('большие материалы: case-analyst на каждый кейс сборки, затем один playbook-builder по разборам', async () => {
		// событие режется до 4000 знаков: чтобы набрать объём, нужно много событий
		const many = events(Math.ceil((BUILD_CHARS / 3500) * 1.2), 3900)
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i, {}, '- none', many)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review merge request', action: 'new_playbook', playbookId: null, members: [...members(['c1', 'c2'], [`n 1–${many.length}`]), ...members(['c3'], ['n 1–3'])], reason: '' }] })
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		const markers = calls.map(c => c.marker)
		assert.equal(markers.filter(m => m === 'CASE ANALYST').length >= 2, true)
		assert.ok(!markers.slice(0, -1).includes('PLAYBOOK BUILDER'))
		assert.equal(markers.filter(m => m === 'PLAYBOOK BUILDER').length, 1)
		assert.ok((calls.find(c => c.marker === 'PLAYBOOK BUILDER')?.prompt ?? '').includes('analysis n 2–6'))
		assert.equal(svc.playbooks?.list().length, 1)
	})

	it('5 готовых кейсов: один match и один вызов сопоставителя со всеми', async () => {
		const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
		for (const [i, id] of ids.entries()) addCase(id, i)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [] })
		const svc = await run([matchJob(ids)])
		assert.deepEqual(calls.map(c => c.marker), ['PLAYBOOK MATCHER'])
		for (const id of ids) assert.ok((calls[0]?.prompt ?? '').includes(`CASE ${id}`))
		assert.deepEqual(kinds(svc), ['match:done'])
	})

	it('обзор: карточки ВСЕХ плейбуков и 350 других кейсов, BM25-подсказки отдельным блоком', async () => {
		addCase('c1', 0)
		for (let i = 2; i <= 351; i++) addCase(`c${i}`, i, {}, '- none', events(2))
		for (const id of ['p-a', 'p-b', 'p-c']) {
			const state: PlaybookState = { ...samplePlaybook(), id, cases: [], heldOut: null, status: (id === 'p-a' ? 'draft' : id === 'p-b' ? 'review' : 'archived'), verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
			pstore.savePlaybook(state, {}, 'init')
		}
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [] })
		await run([matchJob(['c1'])])
		const text = calls[0]?.prompt ?? ''
		for (const id of ['p-a', 'p-b', 'p-c']) assert.ok(text.includes(`PLAYBOOK ${id}`), id)
		for (let i = 2; i <= 351; i++) assert.ok(text.includes(`CASE c${i}\n`), `c${i}`)
		assert.match(text, /<hints>\nc\d+ \| /)
	})

	it('overviewCards: сверх лимита отсеиваются самые давние, но не меньше 300 кейсов', () => {
		const big = 'x'.repeat(500)
		const cards = Array.from({ length: 1000 }, (_v, i) => ({ id: `c${i}`, text: `CASE c${i}\n${big}` }))
		const out = overviewCards(cards)
		assert.ok(out.join('\n\n').length <= OVERVIEW_CHARS)
		assert.ok(out.length >= OVERVIEW_MIN_CASES && out.length < 1000)
		assert.ok(out[0]?.startsWith('CASE c0'))
		// 300 кейсов по 2000 знаков > 400 000, но меньше 300 не бывает
		const many = overviewCards(Array.from({ length: 300 }, (_v, i) => ({ id: `c${i}`, text: 'y'.repeat(2000) })))
		assert.equal(many.length, 300)
	})

	it('проверка отклонила группу (reject): сборка не запускается, плейбуков нет', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		reply['GROUP VERIFIER'] = () => result({ verdict: 'reject', reason: 'different work' })
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		assert.deepEqual(calls.map(c => c.marker), ['PLAYBOOK MATCHER', 'GROUP VERIFIER'])
		assert.equal(svc.playbooks?.list().length, 0)
		assert.ok(!svc.view().jobs.some(j => j.kind === 'build'))
	})

	it('проверка split: остаток из 3 идёт в сборку, остаток из 2 — нет', async () => {
		const ids = ['c1', 'c2', 'c3', 'c4']
		for (const [i, id] of ids.entries()) addCase(id, i)
		reply['PLAYBOOK MATCHER'] = () => result({ groups: [{ task: 't', taskType: 'review', action: 'new_playbook', playbookId: null, members: members(ids), reason: '' }] })
		reply['GROUP VERIFIER'] = () => result({ verdict: 'split', reason: 'c4 differs', members: members(['c1', 'c2', 'c3']).map(m => ({ caseId: m.caseId, goal: m.goal })) })
		const svc = await run([matchJob(['c1', 'c2', 'c3', 'c4'])])
		assert.deepEqual(svc.playbooks?.list().at(0)?.cases.concat(svc.playbooks.list().at(0)?.heldOut ?? []).sort(), ['c1', 'c2', 'c3'])
	})

	it('ответ проверки без <result>: задание проверки остаётся running, сборки нет', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		delete reply['GROUP VERIFIER']
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		const v = svc.view().jobs.find(j => j.kind === 'verify')
		assert.equal(v?.status, 'running')
		assert.equal(svc.playbooks?.list().length, 0)
	})

	it('ответ сопоставителя без <result>: задание остаётся running до повтора, плейбуков нет', async () => {
		for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
		delete reply['PLAYBOOK MATCHER']
		const svc = await run([matchJob(['c1', 'c2', 'c3'])])
		const j = svc.view().jobs[0]
		assert.equal(j?.status, 'running')
		assert.equal(j.attempts, 1)
		assert.equal(svc.playbooks?.list().length, 0)
	})
})
