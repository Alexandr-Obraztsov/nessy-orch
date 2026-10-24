/** HintHost в LearningService (подсказки, очередь, hinted) и взаимное ожидание правки кейса со сборщиком. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, LearningHost } from '../../../src/application/learning/learning.types'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
function repoRoot(): string {
	let dir = __dirname
	for (;;) {
		if (existsSync(join(dir, 'learning', 'prompts', 'editor.md'))) return dir
		const up = dirname(dir)
		if (up === dir) throw new Error('корень репозитория не найден')
		dir = up
	}
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 40; i++) await new Promise<void>(r => setImmediate(r))
}
const rawEvent = (n: number) => ({ n, ts: n, kind: 'task' as const, from: 'you', to: 'a1', text: `шаг ${n}`, ref: `r${n}` })
const baseCase = (id: string, sessions: string[]): CaseState => ({
	id,
	title: 'Case',
	sessions,
	status: 'ready',
	goals: [],
	events: 10,
	coveredUntil: 7,
	createdAt: new Date(T0).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	closedAt: new Date(T0).toISOString(),
	playbook: null,
	source: 'live',
	feedSeq: 5,
	transcripts: {},
	nextN: 11,
	lastEventAt: 0,
	lastRunAt: 0,
	nessyCalls: false,
	hinted: [],
})

describe('LearningService как HintHost', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let release: (() => void) | null
	let started: string[]
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: () => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: req => {
			started.push(req.name)
			return new Promise(resolve => {
				const text = req.name.startsWith('collector') ? '<summary>\n# S\n</summary>' : '<result>\n{"files":{},"note":"","summary":"ok"}\n</result>\nСтатус: ok'
				release = () => resolve({ agentId: 'ag', ok: true, text })
			})
		},
	}
	const make = (): LearningService => {
		const svc = new LearningService({
			store,
			host,
			hub: new Hub(),
			clock: { now: () => T0 + 3_600_000 },
			ids: { next: () => Math.random().toString(36).slice(2, 10) },
			defaultOn: true,
			claudeProjectsDir: '/p',
			playbookStore: pstore,
		})
		svc.load()
		svc.start()
		return svc
	}

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		release = null
		started = []
		store.prompts.set('session-collector', readFileSync(join(repoRoot(), 'learning', 'prompts', 'session-collector.md'), 'utf8'))
		store.prompts.set('editor', readFileSync(join(repoRoot(), 'learning', 'prompts', 'editor.md'), 'utf8'))
	})

	it('caseOf и markHinted: hinted в кейсе сохраняется, повтор не дублирует', () => {
		store.cases.set('c-1', baseCase('c-1', ['s1', 's2']))
		const svc = make()
		assert.equal(svc.hints.caseOf('s2')?.id, 'c-1')
		assert.equal(svc.hints.caseOf('zzz'), null)
		svc.hints.markHinted('s2', 'p-a')
		svc.hints.markHinted('s1', 'p-a')
		assert.deepEqual(svc.getCase('c-1').hinted, ['p-a'])
		assert.deepEqual(store.cases.get('c-1')?.hinted, ['p-a'])
	})

	it('markHinted без кейса держит подсказанное в памяти (hintedOf)', () => {
		const svc = make()
		svc.hints.markHinted('solo', 'p-a')
		const hintedOf = (s: string): string[] | undefined => svc.hints.hintedOf?.(s)
		assert.deepEqual(hintedOf('solo'), ['p-a'])
		assert.deepEqual(hintedOf('other'), [])
	})

	it('queueHint/takeQueued: очередь по кейсу, каждая подсказка один раз, без дублей', () => {
		store.cases.set('c-1', baseCase('c-1', ['s1']))
		const svc = make()
		svc.hints.queueHint('c-1', 'p-a')
		svc.hints.queueHint('c-1', 'p-a')
		svc.hints.queueHint('c-1', 'p-b')
		assert.equal(svc.hints.takeQueued('nope'), null)
		assert.equal(svc.hints.takeQueued('s1'), 'p-a')
		assert.equal(svc.hints.takeQueued('s1'), 'p-b')
		assert.equal(svc.hints.takeQueued('s1'), null)
	})

	it('playbooks() без плейбуков пуст', () => {
		assert.deepEqual(make().hints.playbooks(), [])
	})

	it('правка кейса ждёт running-задание кейса, а close ждёт идущую правку', async () => {
		store.cases.set('c-1', { ...baseCase('c-1', ['s1']), coveredUntil: 0, nextN: 4 })
		store.raw.set('c-1', [rawEvent(1), rawEvent(2), rawEvent(3)])
		const svc = make()
		// идёт правка: close ждёт
		svc.postChat('c-1', 'поправь')
		await flush()
		assert.equal(svc.view().jobs.find(j => j.kind === 'edit')?.status, 'running')
		svc.runNow('c-1')
		await flush()
		assert.equal(svc.view().jobs.find(j => j.kind === 'close')?.status, 'queued')
		release?.()
		await flush()
		assert.equal(svc.view().jobs.find(j => j.kind === 'edit')?.status, 'done')
		assert.notEqual(svc.view().jobs.find(j => j.kind === 'close')?.status, 'queued')
	})

	it('правка кейса не стартует, пока у кейса running-задание', async () => {
		store.cases.set('c-1', { ...baseCase('c-1', ['s1']), coveredUntil: 0, nextN: 4 })
		store.raw.set('c-1', [rawEvent(1), rawEvent(2), rawEvent(3)])
		const svc = make()
		svc.runNow('c-1')
		await flush()
		const close = svc.view().jobs.find(j => j.kind === 'close')
		assert.equal(close?.status, 'running')
		svc.postChat('c-1', 'поправь')
		await flush()
		assert.equal(svc.view().jobs.find(j => j.kind === 'edit')?.status, 'queued')
		// агент закрытия ушёл, не приняв ни одного блока: провал, задание остаётся running и держит замок кейса
		release?.()
		await flush()
		assert.equal(svc.view().jobs.find(j => j.kind === 'close')?.status, 'running')
		assert.equal(svc.view().jobs.find(j => j.kind === 'edit')?.status, 'queued')
		// пользователь снимает задание: замок свободен, правка стартует
		svc.cancelJob(close.id)
		await flush()
		release?.()
		await flush()
		assert.equal(svc.view().jobs.find(j => j.kind === 'close')?.status, 'done')
		assert.equal(svc.view().jobs.find(j => j.kind === 'edit')?.status, 'done')
	})
})
