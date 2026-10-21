/** Согласованность состояния плейбука: откат содержания, замок плейбука, публикация, ждущие правки. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { Message } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { JobQueue } from '../../../src/application/learning/job-queue'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import { mergeReviewPayload } from '../../../src/application/learning/playbook-edits'
import { PlaybookService, restoreContent } from '../../../src/application/learning/playbook.service'
import { rejectEdits } from '../../../src/application/learning/review.handler'
import { AppError } from '../../../src/domain/errors'
import { renderPlaybook } from '../../../src/domain/playbook-render'
import { applyVerdicts } from '../../../src/domain/rule-counters'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const state = (over: Partial<PlaybookState> = {}): PlaybookState => ({ ...samplePlaybook(), id: 'p-x', name: 'p-x', version: 1, verdicts: {}, rejectedEdits: [], reviewAttempts: 0, pendingEdits: [], ...over })
const entry = { revertible: true, revertedBy: null } as const

describe('откат содержания плейбука', () => {
	let store: MemoryPlaybookStore
	let ps: PlaybookService
	let n: number

	const seed = (p: PlaybookState): void => {
		store.savePlaybook(p, renderPlaybook(p, '', ''), 'seed')
		ps.load()
	}

	beforeEach(() => {
		store = new MemoryPlaybookStore()
		n = 0
		ps = new PlaybookService({ store, hub: new Hub(), clock: { now: () => T0 + n++ * 1000 }, ids: { next: () => `i${n++}` } })
	})

	it('restoreContent: содержание из старой версии, рабочие поля и счётчики общих правил — текущие', () => {
		const old = state({ title: 'Старое', rules: [samplePlaybook().rules[0]!, { ...samplePlaybook().rules[1]!, id: 'gone', text: 'Только в старой' }] })
		const cur = state({
			title: 'Новое',
			status: 'disabled',
			cases: ['c1', 'c9'],
			verdicts: { c9: [] },
			rejectedEdits: ['h'],
			rules: [{ ...samplePlaybook().rules[0]!, text: 'Run lint (правка)', up: 7, status: 'archived' }, { ...samplePlaybook().rules[1]!, id: 'fresh' }],
		})
		const back = restoreContent(cur, old)
		assert.equal(back.title, 'Старое')
		assert.deepEqual([back.status, back.cases, back.rejectedEdits, Object.keys(back.verdicts)], ['disabled', ['c1', 'c9'], ['h'], ['c9']])
		assert.deepEqual(back.rules.map(r => r.id), ['r1', 'gone'])
		assert.deepEqual([back.rules[0]?.text, back.rules[0]?.up, back.rules[0]?.status], ['Run lint', 7, 'archived'])
	})

	it('откат записи edit старой версии не стирает статус, кейсы, вердикты и счётчики (сценарий ревьюера s3)', () => {
		seed(state({ status: 'trial' }))
		ps.saveVersion({ ...ps.need('p-x'), title: 'Правка названия' }, 'Edit via chat', { kind: 'edit', subject: 'p-x', summary: 'edit title', report: null, ...entry })
		const edit = ps.journal().find(e => e.kind === 'edit')
		assert.ok(edit)
		// потом: судья накопил счётчики, плейбук стал active, добавились кейсы
		const judged = applyVerdicts(ps.need('p-x'), 'c9', [{ ruleId: 'r1', verdict: 'applied', anchor: 'n 2' }], T0)
		ps.saveVersion(judged, 'Judge c9')
		ps.setStatus('p-x', 'active', 'trial passed')
		ps.addCases('p-x', ['c10'])
		const before = ps.need('p-x')
		ps.revert(edit.id)
		const after = ps.need('p-x')
		assert.equal(after.title, samplePlaybook().title)
		assert.equal(after.status, 'active')
		assert.deepEqual(after.cases, before.cases)
		assert.deepEqual(Object.keys(after.verdicts), ['c9'])
		assert.deepEqual(after.rules.map(r => [r.id, r.up, r.down, r.status]), before.rules.map(r => [r.id, r.up, r.down, r.status]))
		assert.equal(store.published?.active.length, 1)
	})

	it('revertToVersion: содержание из версии, рабочие поля текущие; новее версии записи version/edit помечаются откаченными', () => {
		seed(state({ status: 'active' }))
		ps.saveVersion({ ...ps.need('p-x'), description: 'Use when changed' }, 'improve', { kind: 'version', subject: 'p-x', summary: 'improve', report: null, ...entry })
		ps.addCases('p-x', ['c7'])
		const back = ps.revertToVersion('p-x', 1)
		assert.equal(back.description, samplePlaybook().description)
		assert.deepEqual(back.cases, [...samplePlaybook().cases, 'c7'])
		assert.equal(back.status, 'active')
		const improve = store.journal.find(e => e.kind === 'version')
		assert.ok(improve?.revertedBy)
	})

	it('rejectEdits откатывает к payload.baseVersion, а не по записи журнала; счётчики и статус остаются', () => {
		seed(state({ status: 'active' }))
		ps.saveVersion({ ...ps.need('p-x'), description: 'Use when EDITED' }, 'improve', { kind: 'version', subject: 'p-x', summary: 'improve', report: null, ...entry })
		// пока ревью шло, судья и пользователь успели сделать свои версии
		ps.saveVersion(applyVerdicts(ps.need('p-x'), 'c9', [{ ruleId: 'r1', verdict: 'applied', anchor: 'n 2' }], T0), 'Judge c9')
		ps.setStatus('p-x', 'disabled', 'Set by the user')
		const counted = ps.need('p-x').rules[0]?.up
		const r = rejectEdits(ps, 'p-x', ['h1'], 'плохо', 1)
		assert.equal(r.description, samplePlaybook().description)
		assert.deepEqual(r.rejectedEdits, ['h1'])
		assert.equal(r.status, 'disabled')
		assert.deepEqual(Object.keys(r.verdicts), ['c9'])
		assert.equal(r.rules[0]?.up, counted)
	})
})

describe('удалённый плейбук и публикация', () => {
	let store: MemoryPlaybookStore
	let ps: PlaybookService

	beforeEach(() => {
		store = new MemoryPlaybookStore()
		let n = 0
		ps = new PlaybookService({ store, hub: new Hub(), clock: { now: () => T0 + n++ * 1000 }, ids: { next: () => `i${n++}` } })
		const p = state({ status: 'active' })
		store.savePlaybook(p, renderPlaybook(p, '', ''), 'seed')
		ps.load()
	})

	it('saveVersion и setStatus на удалённом плейбуке — no_playbook, в хранилище он не возвращается', () => {
		const gone = ps.need('p-x')
		ps.remove('p-x')
		for (const call of [() => ps.saveVersion({ ...gone, title: 'z' }, 'late'), () => ps.setStatus('p-x', 'disabled', 'late')]) {
			assert.throws(call, (e: unknown) => e instanceof AppError && e.status === 404 && e.code === 'no_playbook')
		}
		assert.equal(store.snapshots.has('p-x'), false)
		assert.deepEqual(store.published?.active, [])
	})

	it('load() публикует живые плейбуки (плагин совпадает с диском после рестарта)', () => {
		assert.deepEqual(store.published?.active.map(a => a.id), ['p-x'])
		assert.ok(store.publishCalls >= 1)
	})

	it('setNotes живого плейбука сразу публикуется, publishActive берёт заметки из хранилища заметок', () => {
		const calls = store.publishCalls
		ps.setNotes('p-x', '- моя заметка')
		assert.equal(store.publishCalls, calls + 1)
		assert.equal(store.published?.active[0]?.files['notes.md'], '- моя заметка')
		// пустые заметки — заглушка, а не устаревший снимок
		ps.setNotes('p-x', '')
		assert.equal(store.published.active[0].files['notes.md'], '# Notes\n')
	})

	it('setNotes не живого плейбука ничего не публикует', () => {
		ps.setStatus('p-x', 'disabled', 'x')
		const calls = store.publishCalls
		ps.setNotes('p-x', 'заметка')
		assert.equal(store.publishCalls, calls)
	})
})

describe('очередь: объединение payload ревью', () => {
	it('mergeReviewPayload объединяет хэши правок и берёт самую раннюю версию', () => {
		assert.deepEqual(mergeReviewPayload({ edits: ['a', 'b'], baseVersion: 5 }, { edits: ['b', 'c'], baseVersion: 3 }), { edits: ['a', 'b', 'c'], baseVersion: 3 })
		assert.deepEqual(mergeReviewPayload(null, { edits: ['a'], baseVersion: 2 }), { edits: ['a'], baseVersion: 2 })
		assert.equal(mergeReviewPayload(null, null), null)
	})

	it('второй review того же плейбука в очереди не затирает правки первого', () => {
		const q = new JobQueue({ now: () => T0, ids: { next: () => `j${Math.random()}` } })
		q.enqueue('review', 'p-x', { payload: { edits: ['a'], baseVersion: 4 }, merge: mergeReviewPayload })
		const job = q.enqueue('review', 'p-x', { payload: { edits: ['b'], baseVersion: 6 }, merge: mergeReviewPayload })
		assert.deepEqual(job.payload, { edits: ['a', 'b'], baseVersion: 4 })
		assert.equal(q.list().filter(j => j.kind === 'review').length, 1)
	})
})

describe('замок плейбука в LearningService', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let svc: LearningService
	let now: number
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: (): Message[] => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: () => Promise.reject(new Error('агенты не нужны')),
	}
	const wait = async (ms: number): Promise<void> => {
		await new Promise<void>(r => setTimeout(r, ms))
	}
	const closing = (id: string): CaseState => ({
		id, title: id, sessions: [id], status: 'closing', goals: [], events: 12, coveredUntil: 12, createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), closedAt: null,
		playbook: 'p-x@1', source: 'live', feedSeq: 0, transcripts: {}, nextN: 13, lastEventAt: 0, lastRunAt: 0, nessyCalls: false, hinted: [],
	})

	beforeEach(() => {
		now = T0 + 3_600_000
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		let id = 0
		svc = new LearningService({ store, host, hub: new Hub(), clock: { now: () => now }, ids: { next: () => `i${(++id).toString(36).padStart(6, '0')}` }, defaultOn: true, tickMs: 0, claudeProjectsDir: '/p', playbookStore: pstore })
		const p = state({ status: 'active' })
		pstore.savePlaybook(p, renderPlaybook(p, '', ''), 'seed')
		store.cases.set('c7', closing('c7'))
		store.summaries.set('c7', '# T\n')
		svc.load()
		svc.updateSettings({ maxAgents: 5 })
	})

	it('review, edit:p-… и judge (без payload — плейбук берётся из кейса) одного плейбука не идут одновременно', async () => {
		const active = new Set<string>()
		let overlap = 0
		const done: string[] = []
		const track = async (name: string): Promise<void> => {
			// `match` не про этот плейбук: ему замок не нужен
			if (name !== 'match') {
				active.add(name)
				if (active.size > 1) overlap++
			}
			await wait(15)
			active.delete(name)
			done.push(name)
		}
		svc.registerHandler({ kinds: ['review', 'edit', 'judge', 'match'], run: ctx => track(ctx.job.kind).then(() => ctx.finish()) })
		svc.start()
		svc.requestReview('p-x')
		svc.postChat('p-x', 'поправь')
		svc['seal']('c7')
		await wait(120)
		assert.equal(overlap, 0)
		assert.deepEqual([...done].filter(x => x !== 'match').sort(), ['edit', 'judge', 'review'])
		await svc.stop()
	})

	it('removePlaybook: пока работает задание плейбука (даже judge без payload) — 409 playbook_busy', async () => {
		let refused: unknown = null
		svc.registerHandler({
			kinds: ['judge', 'match'],
			run: ctx => {
				if (ctx.job.kind === 'judge') {
					try {
						svc.removePlaybook('p-x')
					} catch (e) {
						refused = e
					}
				}
				ctx.finish()
				return Promise.resolve()
			},
		})
		svc.start()
		svc['seal']('c7')
		await wait(60)
		assert.ok(refused instanceof AppError && refused.status === 409 && refused.code === 'playbook_busy')
		assert.ok(svc.playbooks?.get('p-x'))
		svc.removePlaybook('p-x')
		assert.equal(svc.playbooks?.get('p-x'), null)
		await svc.stop()
	})

	it('acceptEdit/rejectEdit сервиса: 409 пока идёт задание плейбука, иначе применяются', async () => {
		const p = svc.playbooks?.need('p-x')
		assert.ok(p)
		const hash = 'h1'
		const pending = [{ hash, file: 'stages/01-research.md', before: 'findings listed', after: 'findings listed twice', anchor: 'n 1', caseId: 'c1', createdAt: new Date(T0).toISOString() }]
		svc.playbooks?.setPendingEdits('p-x', pending)
		let running = true
		svc.registerHandler({ kinds: ['review'], run: async ctx => { while (running) await wait(5); ctx.finish() } })
		svc.start()
		svc.requestReview('p-x')
		await wait(30)
		assert.throws(() => svc.acceptEdit('p-x', hash), (e: unknown) => e instanceof AppError && e.code === 'playbook_busy')
		running = false
		await wait(30)
		const view = svc.acceptEdit('p-x', hash)
		assert.equal(view.stages[0]?.done, 'findings listed twice')
		assert.deepEqual(view.pendingEdits, [])
		await svc.stop()
	})
})
