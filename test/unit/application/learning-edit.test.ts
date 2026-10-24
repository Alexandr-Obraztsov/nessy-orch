/** Чат правок: кейс (summary.md, курсор цел), плейбук (новая версия, журнал edit), заметки; addCases и saveReview. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { diffEdits } from '../../../src/application/learning/edit.handler'
import { editableFiles } from '../../../src/application/learning/playbook-edits'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

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
const result = (o: unknown): string => `Итог\n<result>\n${JSON.stringify(o)}\n</result>\nСтатус: ok`

const baseCase = (id: string): CaseState => ({
	id,
	title: 'Case',
	sessions: [id],
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

describe('чат правок', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let reply: string
	let prompts: string[]
	let events: HubEvent[]
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: () => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: req => {
			prompts.push(req.prompt)
			return Promise.resolve({ agentId: 'ag', ok: true, text: reply })
		},
	}
	const make = (): LearningService => {
		const hub = new Hub()
		hub.subscribe(e => events.push(e))
		const svc = new LearningService({
			store,
			host,
			hub,
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
	const seedPlaybook = (): PlaybookState => {
		const p: PlaybookState = { ...samplePlaybook(), verdicts: {}, rejectedEdits: [], reviewAttempts: 0, status: 'draft' }
		pstore.snapshots.set(p.id, [{ state: p, files: {}, ts: '2026-10-01T00:00:00Z', message: 'init' }])
		return p
	}

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		prompts = []
		events = []
		reply = ''
		store.prompts.set('editor', readFileSync(join(repoRoot(), 'learning', 'prompts', 'editor.md'), 'utf8'))
	})

	it('кейс: правка меняет summary.md и не трогает курсор; заметка дописывается; ответ — в чат', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.summaries.set('c-1', '# Old\n')
		reply = result({ files: { 'summary.md': '# New\n', 'other.md': 'x' }, note: 'ignore flaky tests', summary: 'Заголовок исправлен' })
		const svc = make()
		const before = JSON.stringify(svc.getCase('c-1'))
		svc.postChat('c-1', 'поправь заголовок')
		await flush()
		assert.equal(store.summaries.get('c-1'), '# New\n')
		assert.equal(JSON.stringify(svc.getCase('c-1')), before)
		assert.equal(store.notes.get('c-1'), '- 2026-10-01: ignore flaky tests\n')
		const chat = pstore.chats.get('c-1') ?? []
		assert.deepEqual(
			chat.map(m => m.from),
			['user', 'agent'],
		)
		assert.deepEqual(chat[1]?.changes, ['summary.md'])
		assert.match(chat.at(1)?.text ?? '', /other\.md/)
		assert.ok(events.some(e => e.t === 'learning_chat'))
		const job = svc.view().jobs.find(j => j.kind === 'edit')
		assert.ok(job)
		assert.equal(job.subject, 'edit:c-1')
		assert.equal(job.status, 'done')
		assert.ok([...store.runs.keys()].some(k => k.startsWith('edit:c-1/') && k.endsWith('-1')))
	})

	it('плейбук: правка текста правила → новая версия, журнал edit, заметка в notes', async () => {
		const p = seedPlaybook()
		const svc = make()
		const rules = editableFiles(p)['rules.md'] ?? ''
		assert.match(rules, /Run lint/)
		reply = result({ files: { 'rules.md': rules.replace('Run lint', 'Run lint and tests') }, note: 'always check X', summary: 'Правило дополнено' })
		svc.postChat(p.id, 'дополни правило про lint')
		await flush()
		const after = svc.playbooks?.get(p.id)
		assert.ok(after)
		assert.equal(pstore.notes.get(p.id), '- 2026-10-01: always check X\n')
		assert.ok(pstore.chats.get(p.id)?.some(m => m.from === 'agent'))
		assert.equal(after.rules.find(r => r.id === 'r1')?.text, 'Run lint and tests')
		assert.equal(after.version, 2)
		const entry = svc.journal().find(e => e.kind === 'edit')
		assert.ok(entry)
		assert.equal(entry.subject, p.id)
		assert.equal(entry.revertible, true)
	})

	it('diffEdits: замена строк, вставка с соседней строкой', () => {
		assert.deepEqual(diffEdits('a\nb\nc', 'a\nB\nc'), [{ before: 'b', after: 'B' }])
		assert.deepEqual(diffEdits('a\nc', 'a\nb\nc'), [{ before: 'a', after: 'a\nb' }])
		assert.deepEqual(diffEdits('a\nb', 'a\nb'), [])
		assert.deepEqual(diffEdits('a\nb', 'b'), [{ before: 'a\nb', after: 'b' }])
	})

	it('addCases не создаёт версию; saveReview попадает в detail.reviews', () => {
		const p = seedPlaybook()
		const svc = make()
		const ps = svc.playbooks
		assert.ok(ps)
		const v = pstore.versions(p.id).length
		const next = ps.addCases(p.id, ['c9', 'c1'])
		assert.deepEqual(next.cases, [...p.cases, 'c9'])
		assert.equal(pstore.versions(p.id).length, v)
		assert.deepEqual(pstore.loadPlaybooks().find(x => x.id === p.id)?.cases, next.cases)
		ps.saveReview({ playbookId: p.id, version: 1, ts: 't', passed: true, stages: [] })
		assert.equal(ps.detail(p.id).reviews.length, 1)
	})

	it('чат: неизвестный объект и пустой текст — ошибка', () => {
		const svc = make()
		assert.throws(() => svc.postChat('c-none', 'x'), /не найден/)
		assert.throws(() => svc.postChat('zzz', 'x'), /чат есть/)
		store.cases.set('c-1', baseCase('c-1'))
		assert.throws(() => make().postChat('c-1', '  '), /text/)
	})
})
