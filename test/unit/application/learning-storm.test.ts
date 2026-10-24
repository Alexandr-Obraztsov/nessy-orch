/** Шторм агентов: память о провале сборки, группы существующих плейбуков, пачки сопоставителя, пачка бэкфилла, затухание, один агент на задание. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost, LearningMeta, PlaybookState } from '../../../src/application/learning/learning.types'
import { PORTION_CHARS } from '../../../src/domain/learning-settings'
import type { RawEvent } from '../../../src/domain/learning.types'
import { renderPlaybook } from '../../../src/domain/playbook-render'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { drainReads } from '../../support/read-blocks'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const HOUR = 3_600_000

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
const PROMPTS = [
	'matcher',
	'group-verifier',
	'playbook-builder',
	'judge',
	'improver',
	'grader',
	'reviewer',
	'consistency',
	'planner',
	'comparator',
	'selector',
	'case-analyst',
	'description-improver',
]
const prompt = (name: string): string => readFileSync(join(repoRoot(), 'learning', 'prompts', `${name}.md`), 'utf8')

const result = (o: unknown): string => `Итог\n<result>\n${JSON.stringify(o)}\n</result>\nСтатус: ok`
const flush = async (n = 120): Promise<void> => {
	for (let i = 0; i < n; i++) await new Promise<void>(r => setTimeout(r, 1))
}
const SUMMARY = (corr: string, pad = ''): string =>
	`# T\n## Goal: review a merge request (type: review-mr)\n### Actions\n- read (n 1–3)${pad}\n### Sources\n- GitLab\n### User corrections\n${corr}\n`
const events = (n: number): RawEvent[] =>
	Array.from({ length: n }, (_v, i) => ({ n: i + 1, ts: T0, kind: 'user', from: 'you', to: null, text: `event ${i + 1}`, ref: `r${i}` }))
const baseCase = (id: string, i: number, over: Partial<CaseState> = {}): CaseState => ({
	id,
	title: `Review ${id}`,
	sessions: [id],
	status: 'ready',
	goals: [{ title: 'review', type: 'review-mr' }],
	events: 12,
	coveredUntil: 12,
	createdAt: new Date(T0 + i * 1000).toISOString(),
	updatedAt: new Date(T0 + i * 1000).toISOString(),
	closedAt: new Date(T0 + i * 1000).toISOString(),
	playbook: null,
	source: 'live',
	feedSeq: 0,
	transcripts: {},
	nextN: 13,
	lastEventAt: 0,
	lastRunAt: 0,
	nessyCalls: false,
	hinted: [],
	...over,
})
const pbState = (id: string, over: Partial<PlaybookState> = {}): PlaybookState => ({
	...samplePlaybook(),
	id,
	name: id,
	verdicts: {},
	rejectedEdits: [],
	reviewAttempts: 0,
	...over,
})
const RULE: PlaybookState['rules'][number] = {
	id: 'r1',
	text: 'Run lint',
	stage: null,
	status: 'active',
	up: 2,
	down: 0,
	evidence: [],
	against: [],
	lastAppliedAt: null,
	createdAt: '2026-10-01T00:00:00Z',
}
const META = (over: Partial<LearningMeta> = {}): LearningMeta => ({ startedAt: 0, startSeq: 0, removed: [], ...over })

describe('шторм агентов', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let calls: Array<{ marker: string; name: string; prompt: string }>
	let reply: Record<string, (p: string) => string>
	let running: number
	let maxRun: number
	let now: number
	let current: LearningService | null = null
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: () => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: async req => {
			drainReads(current)
			const marker = req.prompt.split('\n')[0]?.replace(/^#\s*/, '') ?? ''
			calls.push({ marker, name: req.name, prompt: req.prompt })
			running++
			maxRun = Math.max(maxRun, running)
			await new Promise<void>(r => setTimeout(r, 2))
			running--
			const f = reply[marker]
			return { agentId: `ag${calls.length}`, ok: true, text: f ? f(req.prompt) : 'без результата' }
		},
	}
	const service = (): LearningService =>
		(current = new LearningService({
			store,
			host,
			hub: new Hub(),
			clock: { now: () => now },
			ids: { next: () => Math.random().toString(36).slice(2, 8) },
			defaultOn: true,
			claudeProjectsDir: '/p',
			playbookStore: pstore,
		}))
	const addCase = (id: string, i: number, over: Partial<CaseState> = {}, corr = '- none', pad = '', text = 'event'): void => {
		store.cases.set(id, baseCase(id, i, over))
		store.summaries.set(id, SUMMARY(corr, pad))
		store.raw.set(
			id,
			events(12).map(e => ({ ...e, text: `${text} ${e.n}` })),
		)
	}
	const savePb = (p: PlaybookState): void => {
		pstore.savePlaybook(p, renderPlaybook(p, '', ''), 'init')
	}
	const matchJob = (ids: string[]): JobState => ({
		id: 'j-match',
		kind: 'match',
		caseId: '',
		subject: 'all',
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
		payload: { caseIds: ids },
	})
	const members = (ids: string[]): Array<{ caseId: string; goal: string; anchors: string[] }> =>
		ids.map(caseId => ({ caseId, goal: 'review a merge request', anchors: ['n 2–6'] }))
	const decision = (action: string, ids: string[], playbookId: string | null = null): { groups: unknown[] } => ({
		groups: [{ task: 't', taskType: 'review-mr', action, playbookId, members: members(ids), reason: 'same' }],
	})
	const start = async (jobs: JobState[] = []): Promise<LearningService> => {
		store.jobs = jobs
		const svc = service()
		svc.load()
		svc.start()
		await flush()
		return svc
	}
	const statusOf = (svc: LearningService, id: string): string | undefined => svc.playbooks?.get(id)?.rules[0]?.status
	const savedMeta = (): LearningMeta | null => store.meta
	const count = (marker: string): number => calls.filter(c => c.marker === marker).length

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		calls = []
		running = 0
		maxRun = 0
		now = T0 + HOUR
		for (const n of PROMPTS) store.prompts.set(n, prompt(n))
		reply = { 'GROUP VERIFIER': () => result({ verdict: 'confirm', reason: 'same task' }) }
	})

	describe('B2-7a память о провале сборки', () => {
		const buildJob = (ids: string[]): JobState => ({
			id: 'j-build',
			kind: 'build',
			caseId: '',
			subject: 'g-abc12345',
			status: 'queued',
			attempts: 2,
			agentId: null,
			error: null,
			note: null,
			range: null,
			createdAt: '2026-10-01T10:00:00Z',
			startedAt: null,
			finishedAt: null,
			final: false,
			payload: { task: 't', taskType: 'review-mr', playbookId: null, cases: ids.map(caseId => ({ caseId, anchor: 'n 2–6' })), members: members(ids) },
		})

		it('провал сборки пишет { hash, cases, at } в meta.json', async () => {
			for (const [i, id] of ['c1', 'c2', 'c3'].entries()) addCase(id, i)
			reply['PLAYBOOK BUILDER'] = () => 'мусор'
			const svc = await start([buildJob(['c1', 'c2', 'c3'])])
			assert.equal(svc.view().jobs[0]?.status, 'running') // провал: задание держит слот до повтора
			assert.equal(svc.view().jobs[0]?.attempts, 3)
			assert.deepEqual(savedMeta()?.failedBuilds, [{ hash: 'abc12345', cases: ['c1', 'c2', 'c3'], at: now }])
		})

		it('match не ставит build для группы, у которой ≥ 2/3 кейсов общие с проваленной < 24 ч назад', async () => {
			for (const [i, id] of ['c1', 'c2', 'c3', 'c4'].entries()) addCase(id, i)
			store.meta = META({ failedBuilds: [{ hash: 'x', cases: ['c1', 'c2', 'c3'], at: now - HOUR }] })
			reply['PLAYBOOK MATCHER'] = () => result(decision('new_playbook', ['c1', 'c2', 'c3', 'c4']))
			const svc = await start([matchJob(['c4'])])
			assert.equal(count('PLAYBOOK MATCHER'), 1)
			assert.ok(!svc.view().jobs.some(j => j.kind === 'build'))
		})

		it('провал старше 24 ч не мешает; группа, у которой общих меньше 2/3, тоже', async () => {
			for (const [i, id] of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].entries()) addCase(id, i)
			store.meta = META({ failedBuilds: [{ hash: 'x', cases: ['c1', 'c2', 'c3'], at: now - 25 * HOUR }] })
			reply['PLAYBOOK MATCHER'] = () => result(decision('new_playbook', ['c1', 'c2', 'c3']))
			const svc = await start([matchJob(['c3'])])
			assert.equal(svc.view().jobs.filter(j => j.kind === 'build').length, 1)

			// 3 общих из 6 — меньше 2/3
			store.meta = META({ failedBuilds: [{ hash: 'y', cases: ['c1', 'c2', 'c3'], at: now - HOUR }] })
			store.jobs = []
			reply['PLAYBOOK MATCHER'] = () => result(decision('new_playbook', ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']))
			const svc2 = await start([matchJob(['c6'])])
			assert.equal(svc2.view().jobs.filter(j => j.kind === 'build').length, 1)
		})
	})

	describe('B2-7b группы существующего плейбука', () => {
		beforeEach(() => {
			for (const [i, id] of ['c1', 'c2', 'c3', 'c4', 'c5'].entries()) addCase(id, i)
			savePb(pbState('p-x', { cases: ['c1', 'c2'], heldOut: 'c3', status: 'active' }))
		})

		it('add_to_playbook с кейсами, уже вошедшими в плейбук: проверка и вливание не ставятся', async () => {
			reply['PLAYBOOK MATCHER'] = () => result(decision('add_to_playbook', ['c4', 'c3'], 'p-x'))
			// c4 не в плейбуке — группа годна; c3 отложен — пропускается при вливании
			const svc = await start([matchJob(['c4'])])
			assert.equal(svc.view().jobs.filter(j => j.kind === 'verify').length, 1)
			reply['PLAYBOOK MATCHER'] = () => result(decision('add_to_playbook', ['c1', 'c2'], 'p-x'))
			store.jobs = []
			const svc2 = await start([matchJob(['c2'])])
			assert.ok(!svc2.view().jobs.some(j => j.kind === 'verify' || j.kind === 'absorb'))
		})

		it('new_playbook над теми же кейсами, что уже в плейбуке: ни проверки, ни сборки', async () => {
			reply['PLAYBOOK MATCHER'] = () => result(decision('new_playbook', ['c1', 'c2', 'c3']))
			const svc = await start([matchJob(['c3'])])
			assert.ok(!svc.view().jobs.some(j => j.kind === 'verify' || j.kind === 'build'))
		})

		it('new_playbook с новым кейсом: после проверки одна сборка', async () => {
			reply['PLAYBOOK MATCHER'] = () => result(decision('new_playbook', ['c3', 'c4', 'c5']))
			const svc = await start([matchJob(['c5'])])
			assert.equal(svc.playbooks?.get('p-x')?.cases.length, 2)
			assert.equal(svc.view().jobs.filter(j => j.kind === 'build').length, 1)
		})
	})

	describe('B2-12 сопоставитель', () => {
		it('12 новых кейсов: два вызова подряд (10 + 2), каждый в пределах PORTION_CHARS', async () => {
			const ids = Array.from({ length: 12 }, (_, i) => `n${i + 1}`)
			for (const [i, id] of ids.entries()) addCase(id, i, {}, '- none', ` ${'word '.repeat(4000)}`)
			for (let i = 0; i < 30; i++) addCase(`o${i + 1}`, 20 + i, {}, '- none', ` ${'word '.repeat(4000)}`)
			reply['PLAYBOOK MATCHER'] = () => result({ groups: [] })
			await start([matchJob(ids)])
			assert.equal(count('PLAYBOOK MATCHER'), 2)
			assert.equal(maxRun, 1)
			const limit = PORTION_CHARS + prompt('matcher').length
			for (const c of calls) assert.ok(c.prompt.length <= limit, `${c.prompt.length} > ${limit}`)
			const newIn = (p: string): number => ((/<new-cases>([\s\S]*?)<\/new-cases>/.exec(p)?.[1] ?? '').match(/^CASE n\d+/gm) ?? []).length
			assert.deepEqual(
				calls.map(c => newIn(c.prompt)).sort((a, b) => a - b),
				[2, 10],
			)
		})

		it('соседей на новый кейс — не больше 10', async () => {
			addCase('n1', 0)
			for (let i = 0; i < 30; i++) addCase(`o${i + 1}`, 20 + i)
			reply['PLAYBOOK MATCHER'] = () => result({ groups: [] })
			await start([matchJob(['n1'])])
			assert.equal(count('PLAYBOOK MATCHER'), 1)
			assert.equal(((/<hints>([\s\S]*?)<\/hints>/.exec(calls[0]?.prompt ?? '')?.[1] ?? '').match(/^o\d+ \|/gm) ?? []).length, 10)
		})
	})

	describe('B2-decay затухание раз в сутки', () => {
		const old = (id: string): PlaybookState['rules'][number] => ({
			id,
			text: `rule ${id}`,
			stage: null,
			status: 'active',
			up: 2,
			down: 0,
			evidence: [
				{ caseId: 'c1', anchor: 'n 1' },
				{ caseId: 'c2', anchor: 'n 2' },
			],
			against: [],
			lastAppliedAt: null,
			createdAt: new Date(now - 130 * 24 * HOUR).toISOString(),
		})

		it('старое правило уходит в архив: версия и запись rule_archived; повтор в те же сутки молчит', async () => {
			savePb(pbState('p-x', { status: 'active', rules: [old('r1')] }))
			const svc = await start()
			svc.signal({ event: 'activity', session: 'x' })
			const p = svc.playbooks?.get('p-x')
			assert.equal(p?.rules[0]?.status, 'archived')
			assert.equal(p.version, 2)
			assert.ok(svc.journal().some(e => e.kind === 'rule_archived' && e.subject === 'p-x'))
			assert.equal(savedMeta()?.lastRecountAt, now)
			// ещё раз в течение суток: ничего не пересчитывается
			savePb(pbState('p-y', { status: 'active', rules: [old('r1')], version: 1 }))
			svc.load()
			now += 2 * HOUR
			svc.signal({ event: 'activity', session: 'x' })
			assert.equal(statusOf(svc, 'p-y'), 'active')
			// через сутки — снова
			now += 24 * HOUR
			svc.signal({ event: 'activity', session: 'x' })
			assert.equal(statusOf(svc, 'p-y'), 'archived')
		})
	})

	describe('B2-count худший сценарий и один агент на задание', () => {
		it('кейс с поправками на активном плейбуке: ≤ 20 вызовов, одновременно не больше maxAgents', async () => {
			const msgOk = result({ critical: [], notes: [] })
			reply = {
				'PLAYBOOK MATCHER': () => result({ groups: [] }),
				'RULE JUDGE': () => result({ verdicts: [{ ruleId: 'r1', verdict: 'applied', anchor: 'n 2' }] }),
				'PLAYBOOK IMPROVER': () =>
					result({
						cause: 'gap',
						edits: [{ file: 'SKILL.md', before: 'Ask before pushing', after: 'Ask before pushing twice', anchor: 'n 2' }],
						candidates: [],
					}),
				'PLAYBOOK GRADER': () => msgOk,
				'PLAYBOOK REVIEWER': () => msgOk,
				'PLAYBOOK CONSISTENCY': () => msgOk,
				'TASK PLANNER': () => result({ plan: 'p' }),
				'BLIND COMPARATOR': () => result({ winner: 'tie', reason: 'x' }),
				'PLAYBOOK SELECTOR': p => result({ playbookId: p.includes('foreign') ? null : 'p-x' }),
			}
			for (let i = 1; i <= 6; i++) addCase(`c${i}`, i)
			// два чужих кейса другого типа: судья, сопоставитель, улучшатель (3) + ступени 2–4 (3) + ступень 5 (9) + ступень 6 (3 своих + 2 чужих) = 20; при трёх чужих было бы 21
			for (let i = 1; i <= 2; i++) addCase(`f${i}`, 30 + i, { goals: [{ title: 'other', type: 'other-task' }] }, '- none', '', 'foreign')
			addCase('c7', 7, { status: 'closing', playbook: 'p-x@1' }, '- fix lint (n 2)\n- fix other (n 3)')
			savePb(pbState('p-x', { status: 'active', cases: ['c1', 'c2', 'c3', 'c4', 'c5'], heldOut: 'c6', taskType: 'review-mr' }))
			const svc = await start()
			;(svc as unknown as { seal(id: string): void }).seal('c7')
			await flush(600)
			assert.ok(calls.length <= 20, `вызовов агентов: ${calls.length}: ${calls.map(c => c.name).join()}`)
			assert.ok(maxRun <= svc.getSettings().maxAgents, `одновременно: ${maxRun}`)
			// улучшатель один (match его не ставит; групп нет — ни проверки, ни вливания), ревью правок дошло до конца
			assert.equal(count('PLAYBOOK IMPROVER'), 1)
			assert.equal(count('TASK PLANNER'), 6)
			assert.ok(
				svc.view().jobs.every(j => j.status === 'done'),
				svc
					.view()
					.jobs.map(j => `${j.kind}:${j.status}`)
					.join(),
			)
		})

		it('ступень 6: не больше 3 своих и 3 чужих сообщений, агенты по одному', async () => {
			const msgOk = result({ critical: [], notes: [] })
			reply = {
				'PLAYBOOK GRADER': () => msgOk,
				'PLAYBOOK REVIEWER': () => msgOk,
				'PLAYBOOK CONSISTENCY': () => msgOk,
				'TASK PLANNER': () => result({ plan: 'p' }),
				'BLIND COMPARATOR': () => result({ winner: 'tie', reason: 'x' }),
				'PLAYBOOK SELECTOR': p => result({ playbookId: p.includes('foreign') ? null : 'p-x' }),
			}
			for (let i = 1; i <= 6; i++) addCase(`c${i}`, i)
			for (let i = 1; i <= 6; i++) addCase(`f${i}`, 30 + i, { goals: [{ title: 'other', type: 'other-task' }] }, '- none', '', 'foreign')
			savePb(
				pbState('p-x', {
					status: 'draft',
					cases: ['c1', 'c2', 'c3', 'c4', 'c5'],
					heldOut: 'c6',
					taskType: 'review-mr',
					rules: [
						{
							...RULE,
							evidence: [
								{ caseId: 'c1', anchor: 'n 1' },
								{ caseId: 'c2', anchor: 'n 2' },
							],
						},
					],
				}),
			)
			store.jobs = []
			const svc = await start()
			svc.requestReview('p-x')
			await flush(600)
			assert.equal(count('PLAYBOOK SELECTOR'), 6)
			assert.equal(maxRun, 1)
			assert.deepEqual(
				calls.filter(c => c.marker === 'PLAYBOOK SELECTOR').map(c => c.name.replace(/^review-p-x-6-/, '')),
				['own1', 'own2', 'own3', 'other1', 'other2', 'other3'],
			)
		})
	})
})
