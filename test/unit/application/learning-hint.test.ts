import assert from 'node:assert/strict'
import { DEFAULT_LEARNING } from '../../../src/domain/learning-settings'
import { describe, it } from 'node:test'
import { collectHandler } from '../../../src/application/learning/collect.handler'
import type { HintHost, JobContext } from '../../../src/application/learning/handlers.types'
import { HINT_MIN_SCORE, hintFor, suggest } from '../../../src/application/learning/hint'
import type { CaseState, PlaybookState } from '../../../src/application/learning/learning.types'
import { buildIndex, search } from '../../../src/domain/learning-search'
import { samplePlaybook } from '../../support/sample-playbook'

function pb(id: string, title: string, description: string, taskType: string, status: PlaybookState['status'] = 'active'): PlaybookState {
	return { ...samplePlaybook(), id, name: id, title, description, taskType, status, verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
}

const PACKAGE = pb(
	'p-implement-package',
	'Реализация aff пакета',
	'Используй, когда нужно реализовать aff пакет по тикету: от тикета до MR',
	'implement-package',
)
const REVIEW = pb('p-review-mr', 'Ревью merge request', 'Используй для ревью merge request в GitLab: прочитать диф, оставить замечания', 'review-mr')
const INCIDENT = pb(
	'p-investigate-incident',
	'Расследование инцидента',
	'Используй, когда нужно расследовать инцидент по алерту: логи, Sage, причина',
	'investigate-incident',
)
const ALL = [PACKAGE, REVIEW, INCIDENT]

function caseState(over: Partial<CaseState> = {}): CaseState {
	return {
		id: 'c-s1',
		title: null,
		sessions: ['s1'],
		status: 'collecting',
		goals: [],
		events: 0,
		coveredUntil: 0,
		createdAt: '',
		updatedAt: '',
		closedAt: null,
		playbook: null,
		source: 'live',
		feedSeq: 0,
		transcripts: {},
		nextN: 1,
		lastEventAt: 0,
		lastRunAt: 0,
		nessyCalls: false,
		hinted: [],
		...over,
	}
}

/** Фейковый HintHost: состояние в памяти. */
function fakeHost(playbooks: PlaybookState[], c: CaseState | null = caseState()) {
	const queue: string[] = []
	const host: HintHost = {
		playbooks: () => playbooks,
		caseOf: () => c,
		markHinted: (_s, id) => {
			if (c && !c.hinted.includes(id)) c.hinted.push(id)
		},
		queueHint: (_c, id) => void queue.push(id),
		takeQueued: () => queue.shift() ?? null,
	}
	return { host, queue }
}

const best = (prompt: string): number => {
	const ix = buildIndex(ALL.map(p => ({ id: p.id, text: `${p.description} ${p.taskType} ${p.title}` })))
	for (let i = ix.docs.length; i < 10; i++) ix.docs.push({ id: '', tf: new Map(), len: Math.round(ix.avgLen) })
	return search(ix, prompt, 1)[0]?.score ?? 0
}

describe('подсказка плейбука: suggest', () => {
	it('«реализуй aff пакет для X» выбирает плейбук пакета из трёх', () => {
		assert.equal(suggest({ session: 's1', prompt: 'реализуй aff пакет для оплаты по тикету', caseGoalTypes: [] }, ALL, new Set())?.id, PACKAGE.id)
		assert.equal(suggest({ session: 's1', prompt: 'сделай ревью merge request 42 в GitLab', caseGoalTypes: [] }, ALL, new Set())?.id, REVIEW.id)
	})
	it('«привет» и посторонние запросы не выбирают ничего', () => {
		for (const prompt of ['привет', 'как дела?', 'исправь опечатку в README', 'запусти тесты', 'что такое пакет?']) {
			assert.equal(suggest({ session: 's1', prompt, caseGoalTypes: [] }, ALL, new Set()), null, prompt)
		}
	})
	it('порог HINT_MIN_SCORE отделяет образцы: релевантные выше, посторонние ниже', () => {
		const hit = ['реализуй aff пакет для оплаты по тикету', 'сделай ревью merge request 42 в GitLab', 'расследуй инцидент по алерту, посмотри логи']
		const miss = ['привет', 'исправь опечатку в README', 'запусти тесты', 'что такое пакет?', 'открой тикет и посмотри']
		const low = Math.min(...hit.map(best))
		const high = Math.max(...miss.map(best))
		assert.ok(low >= HINT_MIN_SCORE, `релевантные ${low} >= ${HINT_MIN_SCORE}`)
		assert.ok(high < HINT_MIN_SCORE, `посторонние ${high} < ${HINT_MIN_SCORE}`)
	})
	it('один плейбук в индексе подсказывается так же уверенно, как один из трёх', () => {
		assert.equal(suggest({ session: 's1', prompt: 'реализуй aff пакет для оплаты по тикету', caseGoalTypes: [] }, [PACKAGE], new Set())?.id, PACKAGE.id)
	})
	it('тип цели кейса помогает коротким запросам', () => {
		assert.equal(suggest({ session: 's1', prompt: 'продолжай', caseGoalTypes: ['implement-package', 'aff package'] }, ALL, new Set())?.id, PACKAGE.id)
	})
	it('только trial/active; уже подсказанный не повторяется', () => {
		const draft = { ...PACKAGE, status: 'draft' as const }
		const prompt = 'реализуй aff пакет для оплаты по тикету'
		assert.equal(suggest({ session: 's1', prompt, caseGoalTypes: [] }, [draft, REVIEW], new Set()), null)
		assert.equal(suggest({ session: 's1', prompt, caseGoalTypes: [] }, [{ ...PACKAGE, status: 'trial' }], new Set())?.id, PACKAGE.id)
		assert.equal(suggest({ session: 's1', prompt, caseGoalTypes: [] }, ALL, new Set([PACKAGE.id])), null)
	})
})

describe('подсказка плейбука: hintFor', () => {
	it('отдаёт плейбук и помечает; второй раз тот же — null', () => {
		const { host } = fakeHost(ALL)
		const r = hintFor(host, 's1', 'реализуй aff пакет для оплаты по тикету')
		assert.deepEqual(r.playbook, { id: PACKAGE.id, skill: 'nessy-playbooks:p-implement-package', title: PACKAGE.title })
		assert.deepEqual(hintFor(host, 's1', 'реализуй aff пакет для оплаты по тикету'), { playbook: null })
	})
	it('уже загруженный (case.playbook) не подсказывается', () => {
		const { host } = fakeHost(ALL, caseState({ playbook: `${PACKAGE.id}@2` }))
		assert.equal(hintFor(host, 's1', 'реализуй aff пакет для оплаты по тикету').playbook, null)
	})
	it('подсказка от сборщика отдаётся по нерелевантному запросу один раз', () => {
		const { host, queue } = fakeHost(ALL)
		queue.push(REVIEW.id)
		assert.equal(hintFor(host, 's1', 'привет').playbook?.id, REVIEW.id)
		assert.equal(hintFor(host, 's1', 'привет').playbook, null)
	})
	it('очередь с плейбуком, который перестал быть живым, пропускается, поиск работает', () => {
		const { host, queue } = fakeHost([{ ...REVIEW, status: 'archived' }, PACKAGE])
		queue.push(REVIEW.id)
		assert.equal(hintFor(host, 's1', 'реализуй aff пакет для оплаты по тикету').playbook?.id, PACKAGE.id)
	})
	it('без кейса сессии подсказка всё равно работает', () => {
		const { host } = fakeHost(ALL, null)
		assert.equal(hintFor(host, 's1', 'реализуй aff пакет для оплаты по тикету').playbook?.id, PACKAGE.id)
	})
})

describe('сборщик: подсказка при новой цели', () => {
	function run(before: CaseState, type: string, playbooks: PlaybookState[], withHints = true) {
		const store = { ...before }
		const queue: Array<[string, string]> = []
		const job: { kind: string; caseId: string; final: boolean; range: null; protocol?: { blocks: number } } = {
			kind: 'collect',
			caseId: before.id,
			final: false,
			range: null,
		}
		const ctx = {
			job,
			now: () => 1,
			settings: () => DEFAULT_LEARNING,
			prompt: () => '{{summary}}',
			cases: {
				get: () => store,
				raw: (_id: string, from: number) => (from > 1 ? [] : [{ n: 1, kind: 'user', from: 'user', text: 'x', at: 0 }]),
				summary: () => '',
				notes: () => '',
				writeSummary: () => true,
				writeDraft: () => true,
				sessionTitle: () => 'T',
				update: (c: CaseState) => Object.assign(store, c),
				seal: () => undefined,
			},
			playbooks: { list: () => playbooks },
			hints: withHints ? ({ queueHint: (c: string, p: string) => void queue.push([c, p]) } as unknown as HintHost) : undefined,
			// агент принял блок: сервер уже записал цели принятого описания и сдвинул курсор
			runAgent: () => {
				if (job.protocol) job.protocol.blocks = 1
				Object.assign(store, { goals: type === '' ? store.goals : [{ title: 'g', type }], coveredUntil: 1 })
				return Promise.resolve({ agentId: 'a', text: 'ответ не важен' })
			},
			enqueue: () => undefined,
			finish: () => undefined,
			changed: () => undefined,
		} as unknown as JobContext
		return collectHandler.run(ctx).then(() => queue)
	}

	it('новая цель с типом плейбука кладёт подсказку в очередь', async () => {
		const q = await run(caseState(), 'implement-package', ALL)
		assert.deepEqual(q, [['c-s1', PACKAGE.id]])
	})
	it('цель с тем же типом не новая; чужой тип и уже подсказанный плейбук — ничего', async () => {
		assert.deepEqual(await run(caseState({ goals: [{ title: 'g', type: 'implement-package' }] }), 'implement-package', ALL), [])
		assert.deepEqual(await run(caseState(), 'write-docs', ALL), [])
		assert.deepEqual(await run(caseState({ hinted: [PACKAGE.id] }), 'implement-package', ALL), [])
		assert.deepEqual(await run(caseState(), 'implement-package', [{ ...PACKAGE, status: 'draft' }]), [])
	})
	it('без очереди подсказок в контексте сборщик работает как раньше', async () => {
		assert.deepEqual(await run(caseState(), 'implement-package', ALL, false), [])
	})
})
