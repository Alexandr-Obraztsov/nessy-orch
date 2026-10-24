/** Авто-ревью в шесть ступеней: reviewHandler с фейковым runAgent, ручные approve/reject, откат правок. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import type { LearningSettings, ReviewReport } from '../../../shared/types'
import { AppError } from '../../../src/domain/errors'
import { Hub } from '../../../src/application/hub'
import type { JobContext } from '../../../src/application/learning/handlers.types'
import type { CaseState, JobState, PlaybookState } from '../../../src/application/learning/learning.types'
import { PlaybookService } from '../../../src/application/learning/playbook.service'
import { approvePlaybook, rejectPlaybook, reviewHandler } from '../../../src/application/learning/review.handler'
import type { RawEvent } from '../../../src/domain/learning.types'
import { renderPlaybook } from '../../../src/domain/playbook-render'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

/** Сервис с `saveReview` (в боевом `PlaybookService` его добавляет задача 10). */
class ReviewingService extends PlaybookService {
	constructor(
		private readonly mem: MemoryPlaybookStore,
		...rest: ConstructorParameters<typeof PlaybookService>
	) {
		super(...rest)
	}
	override saveReview(r: ReviewReport): void {
		this.mem.saveReview(r)
	}
}

const T0 = Date.parse('2026-10-01T10:00:00Z')
const PROMPTS = join(process.cwd(), 'learning/prompts')
const MARKERS: Record<string, string> = {
	'# PLAYBOOK GRADER': 'grader',
	'# PLAYBOOK REVIEWER': 'reviewer',
	'# PLAYBOOK CONSISTENCY': 'consistency',
	'# TASK PLANNER': 'planner',
	'# BLIND COMPARATOR': 'comparator',
	'# PLAYBOOK SELECTOR': 'selector',
	'# DESCRIPTION IMPROVER': 'description-improver',
}

const result = (o: unknown): string => `<result>${JSON.stringify(o)}</result>`
const section = (prompt: string, tag: string): string => new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(prompt)?.[1] ?? ''

interface Knobs {
	/** ответ по роли: critical-замечания */
	critical: Record<string, string[]>
	/** сколько сравнений выигрывает план с плейбуком (остальные проигрывает) */
	wins: number
	/** селектор выбирает плейбук для «своих» сообщений: always | never | improved (только при `IMPROVED` в описании) */
	select: 'always' | 'never' | 'improved'
	/** селектор ошибочно выбирает плейбук для сообщений других типов */
	falseHits: boolean
	/** что отвечает description-improver (по умолчанию описание с `IMPROVED`) */
	improved?: string
}

describe('авто-ревью, шесть ступеней', () => {
	let store: MemoryPlaybookStore
	let ps: ReviewingService
	let n: number
	let knobs: Knobs
	let calls: Array<{ role: string; prompt: string }>
	let settings: LearningSettings
	let finished: Array<string | undefined>
	let enqueued: string[]
	let clockMs: number

	const ev = (n: number, kind: RawEvent['kind'], text: string): RawEvent => ({
		n,
		ts: T0 + n,
		kind,
		from: kind === 'user' ? 'you' : 'claude',
		to: null,
		text,
		ref: `r${n}`,
	})
	const SUMMARY_FIRST =
		'# T\n## Goal: do (type: aff)\n### Actions\n- did (n 2–3)\n### User corrections\n- none\n## Goal: later (type: aff)\n### Actions\n- x (n 20)\n'
	const raws: Record<string, RawEvent[]> = {}
	const summaries: Record<string, string> = {}
	const caseState = (id: string, type: string, updatedAt: string): CaseState => ({
		id,
		title: id,
		sessions: [],
		status: 'ready',
		goals: [{ title: 'g', type }],
		events: 3,
		coveredUntil: 9,
		createdAt: updatedAt,
		updatedAt,
		closedAt: null,
		playbook: null,
		source: 'live',
		feedSeq: 0,
		transcripts: {},
		nextN: 10,
		lastEventAt: 0,
		lastRunAt: 0,
		nessyCalls: false,
		hinted: [],
	})
	let caseList: CaseState[]

	const fake = (role: string, prompt: string): string => {
		if (role === 'grader' || role === 'reviewer' || role === 'consistency') return result({ critical: knobs.critical[role] ?? [], notes: ['ok'] })
		if (role === 'planner') return result({ plan: section(prompt, 'playbook') === '(none)' ? 'PLAN_BAD' : 'PLAN_GOOD' })
		if (role === 'comparator') {
			const withCall = calls.filter(c => c.role === 'comparator').length
			const playbookWins = withCall < knobs.wins
			const aIsGood = section(prompt, 'plan-a') === 'PLAN_GOOD'
			// победитель: сторона с хорошим планом, если плейбук выигрывает, иначе противоположная
			const winner = aIsGood === playbookWins ? 'A' : 'B'
			return result({ winner, reason: 'because' })
		}
		if (role === 'selector') {
			const message = section(prompt, 'message')
			const desc = section(prompt, 'playbooks')
			const mine = message.startsWith('own')
			const picks = mine ? knobs.select === 'always' || (knobs.select === 'improved' && desc.includes('IMPROVED')) : knobs.falseHits
			return result({ playbookId: picks ? 'p-1' : null })
		}
		return result({ description: knobs.improved ?? 'Use when IMPROVED: implementing an aff package' })
	}

	const ctxFor = (payload: Record<string, unknown> | null = null): JobContext => {
		const job: JobState = {
			id: 'j1',
			kind: 'review',
			caseId: '',
			subject: 'p-1',
			status: 'running',
			attempts: 1,
			agentId: null,
			error: null,
			note: null,
			range: null,
			createdAt: '',
			startedAt: null,
			finishedAt: null,
			final: false,
			payload,
		}
		return {
			job,
			now: () => clockMs,
			settings: () => settings,
			runAgent: (_name, _title, prompt) => {
				const role = MARKERS[prompt.split('\n')[0] ?? ''] ?? 'unknown'
				const text = fake(role, prompt)
				calls.push({ role, prompt })
				return Promise.resolve({ agentId: `ag${calls.length}`, text })
			},
			prompt: name => readFileSync(join(PROMPTS, `${name}.md`), 'utf8'),
			cases: {
				get: id => caseList.find(c => c.id === id) ?? null,
				all: () => caseList,
				summary: id => summaries[id] ?? '',
				notes: () => '',
				writeNotes: () => undefined,
				writeDraft: () => true,
				sessionTitle: id => id,
				raw: (id, from, to) => (raws[id] ?? []).filter(e => e.n >= from && (to === undefined || e.n <= to)),
				update: () => undefined,
				writeSummary: () => true,
				seal: () => undefined,
				drop: () => undefined,
			},
			playbooks: ps,
			enqueue: (kind, subject) => void enqueued.push(`${kind}:${subject}`),
			chat: () => undefined,
			finish: note => void finished.push(note),
			changed: () => undefined,
			log: () => undefined,
		}
	}

	const state = (status: PlaybookState['status']): PlaybookState => ({
		...samplePlaybook(),
		id: 'p-1',
		name: 'p-1',
		status,
		version: 0,
		cases: ['c1', 'c2'],
		heldOut: 'c3',
		taskType: 'aff',
		verdicts: {},
		rejectedEdits: [],
		reviewAttempts: 0,
	})
	/** новый плейбук в хранилище и в сервисе */
	const seed = (status: PlaybookState['status'] = 'draft'): void => {
		seedState(state(status))
	}
	/** Плейбук появляется на диске (saveVersion на неизвестном плейбуке — `no_playbook`). */
	const seedState = (p: PlaybookState): void => {
		store.savePlaybook(p, renderPlaybook(p, '', ''), 'seed')
		ps.load()
	}
	const roles = (): string[] => calls.map(c => c.role)
	const lastReport = (): ReviewReport => {
		const r = store.reviews.get('p-1')?.at(-1)
		assert.ok(r)
		return r
	}

	beforeEach(() => {
		store = new MemoryPlaybookStore()
		n = 0
		ps = new ReviewingService(store, { store, hub: new Hub(), clock: { now: () => T0 + n++ * 1000 }, ids: { next: () => `i${n++}` } })
		knobs = { critical: {}, wins: 3, select: 'always', falseHits: false }
		calls = []
		finished = []
		enqueued = []
		clockMs = T0
		settings = {
			enabled: true,
			autoReview: true,
			intervalMin: 5,
			idleMin: 30,
			maxAgents: 2,
			retrySec: 60,
			stallMin: 20,
			blockEvents: 80,
			blockChars: 40000,
			archiveDays: 30,
			disabledSessions: [],
		}
		caseList = [
			caseState('c1', 'aff', '2026-10-01T01:00:00Z'),
			caseState('c2', 'aff', '2026-10-01T02:00:00Z'),
			caseState('c3', 'aff', '2026-10-01T03:00:00Z'),
			caseState('c4', 'billing', '2026-10-01T04:00:00Z'),
			caseState('c5', 'billing', '2026-10-01T05:00:00Z'),
		]
		for (const c of caseList) {
			raws[c.id] = [
				ev(1, 'user', `${c.goals[0]?.type === 'aff' ? 'own' : 'other'}-${c.id} first request`),
				ev(2, 'claude', 'plan'),
				ev(9, 'user', `late-${c.id}`),
			]
			summaries[c.id] = SUMMARY_FIRST
		}
		summaries['c1'] = `${SUMMARY_FIRST}### User corrections\n- Proposed: a. User: "b" (n 5)\n- Proposed: c. User: "d" (n 6)\n`
		summaries['c1'] =
			'# T\n## Goal: do (type: aff)\n### Actions\n- did (n 2–3)\n### User corrections\n- Proposed: a. User: "b" (n 5)\n- Proposed: c. User: "d" (n 6)\n'
		summaries['c2'] = '# T\n## Goal: do (type: aff)\n### User corrections\n- none\n'
	})

	it('всё pass: trial, опубликован, журнал review_passed с 6 отчётами, trial.before = среднее поправок', async () => {
		seed()
		await reviewHandler.run(ctxFor())
		const p = ps.need('p-1')
		assert.equal(p.status, 'trial')
		assert.deepEqual(p.trial, { before: 1, cases: [], corrections: [] })
		assert.deepEqual(
			store.published?.active.map(a => a.id),
			['p-1'],
		)
		const entry = store.journal.find(j => j.kind === 'review_passed')
		assert.ok(entry)
		assert.equal(entry.subject, 'p-1')
		const rep = JSON.parse(entry.report ?? '{}') as { review: ReviewReport }
		assert.equal(rep.review.stages.length, 6)
		assert.ok(rep.review.passed)
		assert.deepEqual(
			rep.review.stages.map(s => s.verdict),
			['pass', 'pass', 'pass', 'pass', 'pass', 'pass'],
		)
		assert.deepEqual(
			lastReport().stages.map(s => s.stage),
			[1, 2, 3, 4, 5, 6],
		)
		assert.equal(lastReport().version, p.version)
		assert.deepEqual(finished.length, 1)
		assert.deepEqual(enqueued, [])
	})

	it('ступень 5 берёт первые сообщения по якорю первой цели; в задачу не попадают поздние', async () => {
		seed()
		await reviewHandler.run(ctxFor())
		const planner = calls.find(c => c.role === 'planner')
		assert.ok(planner)
		const task = section(planner.prompt, 'task')
		assert.match(task, /own-c3 first request/)
		assert.doesNotMatch(task, /late-c3/)
		assert.equal(roles().filter(r => r === 'planner').length, 6)
		assert.equal(roles().filter(r => r === 'comparator').length, 3)
	})

	it('critical на ступени 2: ступени 3–6 не запускались, статус review, журнал review_failed', async () => {
		seed()
		knobs.critical['grader'] = ['rule r1 has no evidence']
		await reviewHandler.run(ctxFor())
		assert.deepEqual(roles(), ['grader'])
		const p = ps.need('p-1')
		assert.equal(p.status, 'review')
		assert.equal(p.reviewAttempts, 1)
		assert.deepEqual(
			lastReport().stages.map(s => s.verdict),
			['pass', 'fail', 'skip', 'skip', 'skip', 'skip'],
		)
		assert.ok(!lastReport().passed)
		assert.ok(store.journal.some(j => j.kind === 'review_failed' && /no evidence/.test(j.summary)))
		assert.equal(store.published?.active.length ?? 0, 0)
	})

	it('ступень 5: 2 победы из 3 — pass, 1 — fail', async () => {
		seed()
		knobs.wins = 2
		await reviewHandler.run(ctxFor())
		assert.equal(lastReport().stages[4]?.verdict, 'pass')
		assert.equal(ps.need('p-1').status, 'trial')

		store = new MemoryPlaybookStore()
		ps = new ReviewingService(store, { store, hub: new Hub(), clock: { now: () => T0 + n++ * 1000 }, ids: { next: () => `i${n++}` } })
		seed()
		knobs.wins = 1
		calls = []
		await reviewHandler.run(ctxFor())
		assert.equal(lastReport().stages[4]?.verdict, 'fail')
		assert.equal(ps.need('p-1').status, 'review')
	})

	it('ступень 5: нет heldOut — skip, ревью проходит', async () => {
		seedState({ ...state('draft'), heldOut: null })
		await reviewHandler.run(ctxFor())
		assert.equal(lastReport().stages[4]?.verdict, 'skip')
		assert.equal(ps.need('p-1').status, 'trial')
		assert.ok(!roles().includes('planner'))
	})

	it('ступень 6 провалилась, после description-improver проходит: описание и версия обновлены', async () => {
		seed()
		knobs.select = 'improved'
		await reviewHandler.run(ctxFor())
		const p = ps.need('p-1')
		assert.match(p.description, /IMPROVED/)
		assert.equal(roles().filter(r => r === 'description-improver').length, 1)
		assert.equal(lastReport().stages[5]?.verdict, 'pass')
		assert.equal(p.status, 'trial')
		assert.ok(store.versions('p-1').some(v => /Improved description/.test(v.message)))
	})

	it('ступень 6: описание улучшателя с угловыми скобками или без Use when не принимается (validDescription)', async () => {
		for (const improved of ['Use when <IMPROVED> aff', 'IMPROVED aff package', `Use when IMPROVED ${'x'.repeat(1100)}`]) {
			seed()
			knobs.select = 'improved'
			knobs.improved = improved
			calls = []
			await reviewHandler.run(ctxFor())
			assert.doesNotMatch(ps.need('p-1').description, /IMPROVED/, improved.slice(0, 20))
			assert.equal(roles().filter(r => r === 'selector').length, 5, improved.slice(0, 20))
			assert.equal(lastReport().stages[5]?.verdict, 'fail')
		}
	})

	it('пользователь отключил плейбук во время ревью: ревью статус не меняет', async () => {
		seed()
		const ctx = ctxFor()
		const run = ctx.runAgent.bind(ctx)
		let once = true
		ctx.runAgent = async (n, t, p) => {
			if (once) {
				once = false
				ps.setStatus('p-1', 'disabled', 'Set by the user')
			}
			return run(n, t, p)
		}
		await reviewHandler.run(ctx)
		assert.equal(ps.need('p-1').status, 'disabled')
		assert.equal(ps.need('p-1').reviewAttempts, 0)
		assert.deepEqual(finished.at(-1), 'статус изменён пользователем')
		assert.ok(!store.journal.some(j => j.kind === 'review_passed' || j.kind === 'review_failed'))
	})

	it('плейбук удалён во время ревью: задание завершается, плейбук не воскресает', async () => {
		seed()
		const ctx = ctxFor()
		const run = ctx.runAgent.bind(ctx)
		ctx.runAgent = async (n, t, p) => {
			ps.remove('p-1')
			return run(n, t, p)
		}
		await reviewHandler.run(ctx)
		assert.equal(ps.get('p-1'), null)
		assert.equal(store.snapshots.has('p-1'), false)
		assert.deepEqual(finished.at(-1), 'плейбук удалён')
	})

	it('approve и reject возможны только из draft/review: иначе 409 bad_status', () => {
		for (const status of ['trial', 'active', 'disabled', 'archived'] as const) {
			seed(status)
			assert.throws(() => approvePlaybook(ps, 'p-1', 0), /решать нечего/)
			assert.throws(
				() => rejectPlaybook(ps, 'p-1', 'x'),
				(e: unknown) => e instanceof AppError && e.status === 409 && e.code === 'bad_status',
			)
			assert.equal(ps.need('p-1').status, status)
		}
	})

	it('ступень 6: повторный провал — только заметка, описание прежнее, ревью проходит', async () => {
		seed()
		knobs.select = 'never'
		await reviewHandler.run(ctxFor())
		const p = ps.need('p-1')
		assert.doesNotMatch(p.description, /IMPROVED/)
		const s6 = lastReport().stages[5]
		assert.ok(s6)
		assert.equal(s6.verdict, 'fail')
		assert.deepEqual(s6.critical, [])
		assert.equal(roles().filter(r => r === 'description-improver').length, 1)
		assert.equal(p.status, 'trial')
		assert.ok(lastReport().passed)
	})

	it('ступень 6: ложные срабатывания на чужих типах (> 1) считаются провалом', async () => {
		seed()
		knobs.falseHits = true
		await reviewHandler.run(ctxFor())
		assert.equal(roles().filter(r => r === 'description-improver').length, 1)
		const selectors = calls.filter(c => c.role === 'selector')
		// 3 своих сообщения (c1, c2, c3) и 2 чужих (c4, c5), дважды (до и после улучшения)
		assert.equal(selectors.length, 10)
		assert.equal(lastReport().stages[5]?.verdict, 'fail')
	})

	it('autoReview: false — агентов нет, статус review', async () => {
		seed()
		settings = { ...settings, autoReview: false }
		await reviewHandler.run(ctxFor())
		assert.deepEqual(calls, [])
		assert.equal(ps.need('p-1').status, 'review')
		assert.equal(finished.length, 1)
	})

	it('не уходит в цикл: повторный провал — задание завершено, новых заданий нет', async () => {
		seed()
		knobs.critical['reviewer'] = ['not from sessions']
		await reviewHandler.run(ctxFor())
		assert.equal(ps.need('p-1').status, 'review')
		await reviewHandler.run(ctxFor())
		assert.equal(ps.need('p-1').status, 'review')
		assert.equal(ps.need('p-1').reviewAttempts, 2)
		assert.deepEqual(enqueued, [])
		assert.equal(finished.length, 2)
	})

	it('ревью правок: провал откатывает версию и пишет хэши в rejectedEdits', async () => {
		seedState(state('active'))
		const base = ps.need('p-1')
		ps.saveVersion({ ...base, description: 'Use when EDITED' }, 'edit', {
			kind: 'edit',
			subject: 'p-1',
			summary: 'правка',
			report: null,
			revertible: true,
			revertedBy: null,
		})
		assert.equal(ps.need('p-1').version, 2)
		knobs.critical['consistency'] = ['contradicts p-2']
		await reviewHandler.run(ctxFor({ edits: ['h1', 'h2'], baseVersion: 1 }))
		const p = ps.need('p-1')
		assert.equal(p.description, base.description)
		assert.deepEqual(p.rejectedEdits, ['h1', 'h2'])
		assert.equal(p.status, 'active')
		assert.ok(store.journal.some(j => j.kind === 'reverted'))
		assert.ok(store.journal.some(j => j.kind === 'review_failed'))
		assert.ok(!roles().includes('planner'))
	})

	it('ревью правок: успех оставляет версию и статус, без перехода в trial', async () => {
		seedState(state('active'))
		ps.saveVersion({ ...ps.need('p-1'), description: 'Use when EDITED' }, 'edit', {
			kind: 'edit',
			subject: 'p-1',
			summary: 'правка',
			report: null,
			revertible: true,
			revertedBy: null,
		})
		await reviewHandler.run(ctxFor({ edits: ['h1'], baseVersion: 1 }))
		const p = ps.need('p-1')
		assert.equal(p.status, 'active')
		assert.equal(p.trial, null)
		assert.ok(store.journal.some(j => j.kind === 'review_passed'))
		assert.equal(lastReport().passed, true)
	})

	it('approve → trial с before, reject → disabled; журнал', () => {
		seed('review')
		approvePlaybook(ps, 'p-1', 2)
		assert.equal(ps.need('p-1').status, 'trial')
		assert.equal(ps.need('p-1').trial?.before, 2)
		assert.ok(store.journal.some(j => j.kind === 'review_passed'))
		seed('review')
		rejectPlaybook(ps, 'p-1', 'мимо')
		assert.equal(ps.need('p-1').status, 'disabled')
		assert.ok(store.journal.some(j => j.kind === 'review_failed' && /мимо/.test(j.summary)))
	})
})
