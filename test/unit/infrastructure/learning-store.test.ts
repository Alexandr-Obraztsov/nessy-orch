import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { LearningSettings } from '../../../shared/types'
import type { CaseState, JobState } from '../../../src/application/learning/learning.types'
import type { RawEvent } from '../../../src/domain/learning.types'
import { FileLearningStore } from '../../../src/infrastructure/persistence/learning-store'

const SETTINGS: LearningSettings = { enabled: true, autoReview: false, intervalMin: 10, idleMin: 30, maxAgents: 2, retrySec: 60, stallMin: 20, blockEvents: 80, blockChars: 40000, archiveDays: 30, disabledSessions: [] }

function mkCase(id: string, over: Partial<CaseState> = {}): CaseState {
	return {
		id,
		title: 'Заголовок: "с кавычками"',
		sessions: ['s1', 's2'],
		status: 'collecting',
		goals: [{ title: 'цель', type: 'fix' }],
		events: 0,
		coveredUntil: 0,
		createdAt: '2026-10-18T10:00:00.000Z',
		updatedAt: '2026-10-18T10:00:00.000Z',
		closedAt: null,
		playbook: null,
		source: 'live',
		feedSeq: 0,
		transcripts: {},
		hinted: [],
		nextN: 1,
		lastEventAt: 0,
		lastRunAt: 0,
		nessyCalls: false,
		...over,
	}
}

function ev(n: number): RawEvent {
	return { n, ts: n * 1000, kind: 'user', from: 'user', to: null, text: `e${n}`, ref: `r${n}` }
}

describe('FileLearningStore', () => {
	let tmp: string
	let home: string
	let root: string
	let store: FileLearningStore
	const origError = console.error

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-store-'))
		home = path.join(tmp, 'home')
		root = path.join(tmp, 'root')
		fs.mkdirSync(home)
		store = new FileLearningStore(home, root)
	})
	afterEach(() => {
		console.error = origError
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('настройки: нет файла — raw undefined, mtime 0; после записи mtime растёт', () => {
		assert.deepEqual(store.loadSettings(), { raw: undefined, mtimeMs: 0 })
		assert.equal(store.settingsMtime(), 0)
		store.saveSettings(SETTINGS)
		const first = store.settingsMtime()
		assert.ok(first > 0)
		assert.deepEqual(store.loadSettings().raw, SETTINGS)
		const file = path.join(home, 'learning.json')
		fs.utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
		assert.ok(store.settingsMtime() > first)
	})

	it('кейс: saveCase + loadCases — круг, case.md с frontmatter и телом из summary', () => {
		const c = mkCase('c1', { feedSeq: 7, transcripts: { chat1: { path: '/t/1.jsonl', offset: 42 } } })
		store.saveCase(c)
		assert.deepEqual(store.loadCases(), [c])
		const md = fs.readFileSync(path.join(store.casesDir, 'c1', 'case.md'), 'utf8')
		assert.ok(md.startsWith('---\nid: c1\n'), md)
		assert.match(md, /\nstatus: collecting\n/)
		assert.match(md, /\nsessions: \["s1","s2"\]\n/)
		store.writeSummary('c1', '# Итог\nтекст')
		assert.equal(store.readSummary('c1'), '# Итог\nтекст')
		const md2 = fs.readFileSync(path.join(store.casesDir, 'c1', 'case.md'), 'utf8')
		assert.ok(md2.endsWith('# Итог\nтекст\n'), md2)
		assert.equal(store.readNotes('c1'), '')
	})

	it('битый state.json пропускается с предупреждением', () => {
		store.saveCase(mkCase('ok'))
		fs.mkdirSync(path.join(store.casesDir, 'bad'))
		fs.writeFileSync(path.join(store.casesDir, 'bad', 'state.json'), '{не json')
		fs.mkdirSync(path.join(store.casesDir, 'empty'))
		const warns: string[] = []
		console.error = (m: unknown) => void warns.push(String(m))
		assert.deepEqual(store.loadCases().map(c => c.id), ['ok'])
		assert.equal(warns.length, 1)
	})

	it('copyTranscript: только целые строки, дозапись, усечение, нет файла', () => {
		const src = path.join(tmp, 't.jsonl')
		fs.writeFileSync(src, 'a\nb\nc')
		const r1 = store.copyTranscript('c1', 'chat/1', { path: src, offset: 0 })
		assert.equal(r1.text, 'a\nb\n')
		assert.equal(r1.next.offset, 4)
		assert.equal(r1.next.path, src)
		const dst = path.join(store.casesDir, 'c1', 'raw', 'transcript-chat_1.jsonl')
		assert.equal(fs.readFileSync(dst, 'utf8'), 'a\nb\n')
		const none = store.copyTranscript('c1', 'chat/1', r1.next)
		assert.equal(none.text, '')
		assert.deepEqual(none.next, r1.next)
		fs.appendFileSync(src, '\n')
		const r2 = store.copyTranscript('c1', 'chat/1', r1.next)
		assert.equal(r2.text, 'c\n')
		assert.equal(r2.next.offset, 6)
		assert.equal(fs.readFileSync(dst, 'utf8'), 'a\nb\nc\n')
		fs.writeFileSync(src, 'x\n')
		const r3 = store.copyTranscript('c1', 'chat/1', r2.next)
		assert.equal(r3.text, 'x\n')
		assert.equal(r3.next.offset, 2)
		const gone = { path: path.join(tmp, 'нет.jsonl'), offset: 5 }
		const r4 = store.copyTranscript('c1', 'chat/1', gone)
		assert.equal(r4.text, '')
		assert.deepEqual(r4.next, gone)
	})

	it('copyTranscript: многобайтовые символы считаются в байтах', () => {
		const src = path.join(tmp, 'u.jsonl')
		fs.writeFileSync(src, 'привет\nещё')
		const r = store.copyTranscript('c1', 'ch', { path: src, offset: 0 })
		assert.equal(r.text, 'привет\n')
		assert.equal(r.next.offset, Buffer.byteLength('привет\n'))
	})

	it('appendRaw / readRaw по диапазону n', () => {
		store.appendRaw('c1', [ev(1), ev(2), ev(3)])
		store.appendRaw('c1', [ev(4), ev(5), ev(6)])
		assert.deepEqual(store.readRaw('c1', 3, 5).map(e => e.n), [3, 4, 5])
		assert.deepEqual(store.readRaw('c1', 5).map(e => e.n), [5, 6])
		assert.deepEqual(store.readRaw('nope', 1), [])
	})

	it('removeCase удаляет каталог целиком', () => {
		store.saveCase(mkCase('c1'))
		store.appendRaw('c1', [ev(1)])
		store.removeCase('c1')
		assert.equal(fs.existsSync(path.join(store.casesDir, 'c1')), false)
		assert.deepEqual(store.loadCases(), [])
	})

	it('очередь: saveJobs / loadJobs', () => {
		assert.deepEqual(store.loadJobs(), [])
		const j: JobState = { id: 'j1', kind: 'collect', caseId: 'c1', subject: 'c1', status: 'queued', attempts: 0, agentId: null, error: null, note: null, range: [1, 5], createdAt: 'x', startedAt: null, finishedAt: null, final: false, payload: null }
		store.saveJobs([j])
		assert.deepEqual(store.loadJobs(), [j])
	})

	it('миграция jobs.json этапа 1: нет subject — caseId, нет payload — null', () => {
		const old = { id: 'j1', kind: 'collect', caseId: 'c1', status: 'queued', attempts: 0, agentId: null, error: null, note: null, range: null, createdAt: 'x', startedAt: null, finishedAt: null, final: false, retryAt: null }
		fs.mkdirSync(path.join(store.home, 'learning'), { recursive: true })
		fs.writeFileSync(path.join(store.home, 'learning', 'jobs.json'), JSON.stringify({ jobs: [old] }))
		const loaded = store.loadJobs()
		assert.equal(loaded.length, 1)
		assert.deepEqual(loaded.map(j => [j.subject, j.payload]), [['c1', null]])
	})

	it('черновик: writeDraft пишет cases/<id>/draft.md, readDraft читает, пустой текст удаляет', () => {
		assert.equal(store.readDraft('c1'), '')
		assert.equal(store.writeDraft('c1', '# черновик'), true)
		assert.equal(fs.readFileSync(path.join(store.casesDir, 'c1', 'draft.md'), 'utf8'), '# черновик')
		assert.equal(store.readDraft('c1'), '# черновик')
		assert.equal(store.writeDraft('c1', ''), true)
		assert.equal(fs.existsSync(path.join(store.casesDir, 'c1', 'draft.md')), false)
		assert.equal(store.writeDraft('c-нет', ''), true)
	})

	it('writeNotes пишет cases/<id>/notes.md, readNotes читает', () => {
		store.writeNotes('c1', '- заметка')
		assert.equal(store.readNotes('c1'), '- заметка')
	})

	it('кейс без hinted в state.json загружается с []', () => {
		const c = mkCase('c1')
		store.saveCase(c)
		const file = path.join(store.casesDir, 'c1', 'state.json')
		const old: Record<string, unknown> = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
		delete old['hinted']
		fs.writeFileSync(file, JSON.stringify(old))
		assert.deepEqual(store.loadCases()[0]?.hinted, [])
	})

	it('readPrompt читает <root>/learning/prompts/<name>.md', () => {
		assert.equal(store.readPrompt('session-collector'), '')
		fs.mkdirSync(path.join(root, 'learning', 'prompts'), { recursive: true })
		fs.writeFileSync(path.join(root, 'learning', 'prompts', 'session-collector.md'), 'промпт')
		assert.equal(store.readPrompt('session-collector'), 'промпт')
	})

	it('raw: truncateRaw режет хвост за nextN, readRaw при повторе n берёт последнюю запись', () => {
		store.saveCase(mkCase('c1'))
		store.appendRaw('c1', [ev(1), ev(2), ev(3), ev(4)])
		store.truncateRaw('c1', 3)
		assert.deepEqual(store.readRaw('c1', 1).map(e => e.n), [1, 2])
		store.appendRaw('c1', [{ ...ev(2), text: 'новый' }])
		assert.deepEqual(store.readRaw('c1', 1).map(e => e.text), ['e1', 'новый'])
	})

	it('writeSummary / appendRaw возвращают false при сбое диска', () => {
		console.error = () => {}
		assert.equal(store.writeSummary('c1', 'x'), true)
		assert.equal(store.appendRaw('c1', [ev(1)]), true)
		fs.rmSync(store.casesDir, { recursive: true, force: true })
		fs.writeFileSync(store.casesDir, 'файл вместо каталога')
		assert.equal(store.writeSummary('c1', 'x'), false)
		assert.equal(store.appendRaw('c1', [ev(1)]), false)
	})

	it('meta: нет файла — null; круг; ответы агентов в runs/', () => {
		assert.equal(store.loadMeta(), null)
		store.saveMeta({ startedAt: 5, startSeq: 7, removed: ['s1'] })
		assert.deepEqual(store.loadMeta(), { startedAt: 5, startSeq: 7, removed: ['s1'] })
		store.writeRun('c-1', 'j1', 'ответ')
		assert.equal(fs.readFileSync(path.join(store.casesDir, 'c-1', 'runs', 'j1.md'), 'utf8'), 'ответ')
	})

	it('writeRun: кейсовые ответы — в кейсе, прочие — в learning/runs/<subject без «:»>; loadCases их не замечает', () => {
		store.writeRun('c-1', 'j1-2', 'a')
		store.writeRun('judge:c-1', 'j2-1', 'b')
		store.writeRun('g-abc', 'j3-1', 'c')
		assert.equal(fs.readFileSync(path.join(store.casesDir, 'c-1', 'runs', 'j1-2.md'), 'utf8'), 'a')
		assert.equal(fs.readFileSync(path.join(store.home, 'learning', 'runs', 'judge_c-1', 'j2-1.md'), 'utf8'), 'b')
		assert.equal(fs.readFileSync(path.join(store.home, 'learning', 'runs', 'g-abc', 'j3-1.md'), 'utf8'), 'c')
		assert.ok(!fs.existsSync(path.join(store.casesDir, 'g-abc')))
		assert.deepEqual(store.loadCases(), [])
	})

	it('readRuns: ответы задания по порядку k, чужие задания и подсказки не попадают; нет каталога — пусто', () => {
		store.writeRun('c-1', 'j1-10', 'десятый')
		store.writeRun('c-1', 'j1-2', 'второй')
		store.writeRun('c-1', 'j1-1', 'первый')
		store.writeRun('c-1', 'j12-1', 'чужой')
		store.writeRun('judge:c-1', 'j2-1', 'судья')
		assert.deepEqual(store.readRuns('c-1', 'j1'), [{ name: 'j1-1', text: 'первый' }, { name: 'j1-2', text: 'второй' }, { name: 'j1-10', text: 'десятый' }])
		assert.deepEqual(store.readRuns('judge:c-1', 'j2'), [{ name: 'j2-1', text: 'судья' }])
		assert.deepEqual(store.readRuns('c-9', 'j1'), [])
	})

	it('isAllowedTranscript: только .jsonl внутри каталога, symlink наружу не проходит', () => {
		const dir = path.join(tmp, 'projects')
		fs.mkdirSync(path.join(dir, 'p'), { recursive: true })
		fs.writeFileSync(path.join(dir, 'p', 'a.jsonl'), '{}\n')
		fs.writeFileSync(path.join(dir, 'p', 'a.txt'), 'x')
		fs.writeFileSync(path.join(tmp, 'out.jsonl'), '{}\n')
		fs.symlinkSync(path.join(tmp, 'out.jsonl'), path.join(dir, 'p', 'link.jsonl'))
		assert.equal(store.isAllowedTranscript(path.join(dir, 'p', 'a.jsonl'), dir), true)
		assert.equal(store.isAllowedTranscript(path.join(dir, 'p', 'a.txt'), dir), false)
		assert.equal(store.isAllowedTranscript(path.join(tmp, 'out.jsonl'), dir), false)
		assert.equal(store.isAllowedTranscript(path.join(dir, 'p', 'link.jsonl'), dir), false)
		assert.equal(store.isAllowedTranscript(path.join(dir, '..', 'projects', 'p', 'a.jsonl'), dir), true)
		assert.equal(store.isAllowedTranscript(path.join(dir, 'p', 'нет.jsonl'), dir), false)
	})

	it('copyTranscript читает не больше 8 МБ за вызов, остаток — в следующий', () => {
		const file = path.join(tmp, 't.jsonl')
		const line = JSON.stringify({ x: 'a'.repeat(1023) }) + '\n'
		const n = Math.ceil((9 * 1024 * 1024) / line.length)
		fs.writeFileSync(file, line.repeat(n))
		const a = store.copyTranscript('c1', 'chat', { path: file, offset: 0 })
		assert.ok(a.next.offset > 0 && a.next.offset <= 8 * 1024 * 1024)
		assert.equal(a.text.length, a.next.offset)
		const b = store.copyTranscript('c1', 'chat', a.next)
		assert.equal(a.next.offset + b.text.length, line.length * n)
	})
})
