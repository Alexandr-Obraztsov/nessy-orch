import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { ChatMessage, JournalEntry, ReviewReport } from '../../../shared/types'
import type { PlaybookState } from '../../../src/application/learning/learning.types'
import { FilePlaybookStore } from '../../../src/infrastructure/persistence/playbook-store'

function mkPlaybook(id: string, over: Partial<PlaybookState> = {}): PlaybookState {
	return {
		id,
		name: id,
		title: 'Плейбук',
		description: 'Use when testing',
		taskType: 'fix',
		status: 'draft',
		version: 1,
		cases: ['c-1'],
		heldOut: null,
		params: [],
		sources: [],
		files: [],
		behavior: [],
		stages: [],
		rules: [],
		trial: null,
		createdAt: '2026-10-18T10:00:00.000Z',
		updatedAt: '2026-10-18T10:00:00.000Z',
		verdicts: {},
		rejectedEdits: [],
		reviewAttempts: 0,
		...over,
	}
}

function mkEntry(id: string, over: Partial<JournalEntry> = {}): JournalEntry {
	return { id, ts: '2026-10-18T10:00:00.000Z', kind: 'version', subject: 'p-aff', summary: id, report: null, revertible: true, revertedBy: null, ...over }
}

function mkMsg(id: string): ChatMessage {
	return { id, ts: '2026-10-18T10:00:00.000Z', from: 'user', text: id, changes: [] }
}

describe('FilePlaybookStore', () => {
	let tmp: string
	let home: string
	let pluginDir: string
	let store: FilePlaybookStore
	const origError = console.error

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playbook-store-'))
		home = path.join(tmp, 'home')
		pluginDir = path.join(tmp, 'plugin', 'nessy-playbooks')
		fs.mkdirSync(home)
		store = new FilePlaybookStore(home, pluginDir)
	})
	afterEach(() => {
		console.error = origError
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	const stage = (ext: string): string => path.join(path.dirname(path.dirname(pluginDir)), '.nessy-playbooks' + ext)

	it('.gitignore: заметки и чат корня вне git, files/notes.md — в git', () => {
		store.savePlaybook(mkPlaybook('p-aff'), { 'SKILL.md': 'A', 'notes.md': 'N' }, 'v1')
		store.writeNotes('p-aff', 'мои заметки')
		store.appendChat('p-aff', mkMsg('m1'))
		store.saveReview({ playbookId: 'p-aff', version: 1, ts: '2026-10-18T10:00:00.000Z', passed: true, stages: [] })
		const dir = path.join(store.playbooksDir, 'p-aff')
		store.savePlaybook(mkPlaybook('p-aff'), { 'SKILL.md': 'A', 'notes.md': 'N' }, 'v2')
		const tracked = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean).sort()
		assert.deepEqual(tracked, ['.gitignore', 'files/SKILL.md', 'files/notes.md', 'playbook.json'])
	})

	it('сбой git при сохранении: playbook.json и файлы возвращаются к последнему коммиту', () => {
		console.error = () => {}
		store.savePlaybook(mkPlaybook('p-aff', { status: 'active' }), { 'SKILL.md': 'A' }, 'v1')
		store.writeNotes('p-aff', 'заметки живы')
		const dir = path.join(store.playbooksDir, 'p-aff')
		const hook = path.join(dir, '.git', 'hooks', 'pre-commit')
		fs.mkdirSync(path.dirname(hook), { recursive: true })
		fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
		assert.throws(() => store.savePlaybook(mkPlaybook('p-aff', { status: 'disabled' }), { 'SKILL.md': 'B', 'new.md': 'N' }, 'v2'))
		const disk: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'playbook.json'), 'utf8'))
		assert.equal((disk as PlaybookState).status, 'active')
		assert.deepEqual(store.readFiles('p-aff'), { 'SKILL.md': 'A' })
		assert.equal(store.readNotes('p-aff'), 'заметки живы')
		assert.equal(store.versions('p-aff').length, 1)
	})

	it('сбой первого коммита не оставляет playbook.json', () => {
		console.error = () => {}
		const dir = path.join(store.playbooksDir, 'p-new')
		fs.mkdirSync(dir, { recursive: true })
		execFileSync('git', ['init', '-q'], { cwd: dir })
		fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true })
		fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
		assert.throws(() => store.savePlaybook(mkPlaybook('p-new'), { 'SKILL.md': 'A' }, 'v1'))
		assert.ok(!fs.existsSync(path.join(dir, 'playbook.json')))
		assert.deepEqual(store.loadPlaybooks(), [])
	})

	it('временные папки публикации лежат вне каталога плагина; остатки удаляются при старте', () => {
		fs.mkdirSync(stage('.tmp'), { recursive: true })
		fs.mkdirSync(stage('.old'), { recursive: true })
		store = new FilePlaybookStore(home, pluginDir)
		assert.ok(!fs.existsSync(stage('.tmp')) && !fs.existsSync(stage('.old')))
		store.publish([{ id: 'p-aff', files: { 'SKILL.md': 'A' } }], '1')
		assert.deepEqual(fs.readdirSync(path.dirname(pluginDir)), ['nessy-playbooks'])
	})

	it('сохраняет версии, отдаёт историю и восстанавливает прежнюю', () => {
		assert.equal(store.savePlaybook(mkPlaybook('p-aff'), { 'SKILL.md': 'v1', 'refs/a.md': 'a' }, 'создан'), 1)
		assert.equal(store.savePlaybook(mkPlaybook('p-aff', { version: 2, title: 'Новый' }), { 'SKILL.md': 'v2' }, 'правка'), 2)
		assert.deepEqual(store.versions('p-aff').map(v => [v.version, v.message]), [[1, 'создан'], [2, 'правка']])
		assert.deepEqual(store.readFiles('p-aff'), { 'SKILL.md': 'v2' })
		const r = store.restoreVersion('p-aff', 1)
		assert.ok(r)
		assert.deepEqual(r.files, { 'SKILL.md': 'v1', 'refs/a.md': 'a' })
		assert.equal(r.state.title, 'Плейбук')
		assert.equal(store.restoreVersion('p-aff', 3), null)
		assert.equal(store.restoreVersion('p-none', 1), null)
		assert.equal(store.loadPlaybooks().length, 1)
		assert.equal(store.loadPlaybooks()[0]?.title, 'Новый')
	})

	it('неизменённое сохранение не растит версию', () => {
		const p = mkPlaybook('p-aff')
		store.savePlaybook(p, { 'SKILL.md': 'x' }, 'один')
		assert.equal(store.savePlaybook(p, { 'SKILL.md': 'x' }, 'два'), 1)
		assert.equal(store.versions('p-aff').length, 1)
	})

	it('удаляет плейбук', () => {
		store.savePlaybook(mkPlaybook('p-aff'), { 'SKILL.md': 'x' }, 'm')
		store.removePlaybook('p-aff')
		assert.deepEqual(store.loadPlaybooks(), [])
		assert.deepEqual(store.versions('p-aff'), [])
	})

	it('отклоняет небезопасные id и пути файлов', () => {
		assert.throws(() => store.savePlaybook(mkPlaybook('../evil'), {}, 'm'))
		assert.throws(() => store.savePlaybook(mkPlaybook('p-aff'), { '../x': 'x' }, 'm'))
		assert.throws(() => store.savePlaybook(mkPlaybook('p-aff'), { '/abs': 'x' }, 'm'))
		assert.throws(() => store.readNotes('p-../x'))
		assert.throws(() => store.appendChat('../x', mkMsg('m')))
		assert.ok(!fs.existsSync(path.join(tmp, 'evil')))
	})

	it('заметки, ревью по версиям', () => {
		store.savePlaybook(mkPlaybook('p-aff'), { 'SKILL.md': 'x' }, 'm')
		assert.equal(store.readNotes('p-aff'), '')
		store.writeNotes('p-aff', 'заметка')
		assert.equal(store.readNotes('p-aff'), 'заметка')
		const rv = (version: number): ReviewReport => ({ playbookId: 'p-aff', version, ts: 't', passed: version === 2, stages: [] })
		store.saveReview(rv(2))
		store.saveReview(rv(1))
		assert.deepEqual(store.loadReviews('p-aff').map(r => r.version), [1, 2])
		// заметки и ревью вне git
		store.savePlaybook(mkPlaybook('p-aff'), { 'SKILL.md': 'x' }, 'ещё')
		assert.equal(store.versions('p-aff').length, 1)
	})

	it('журнал: добавить, обновить, последние', () => {
		store.appendJournal(mkEntry('j1'))
		store.appendJournal(mkEntry('j2'))
		store.appendJournal(mkEntry('j3'))
		store.updateJournal(mkEntry('j2', { revertedBy: 'j4' }))
		store.updateJournal(mkEntry('нет'))
		assert.equal(store.loadJournal(10).length, 3)
		const last = store.loadJournal(2)
		assert.deepEqual(last.map(e => e.id), ['j2', 'j3'])
		assert.equal(last[0]?.revertedBy, 'j4')
	})

	it('чаты кейса и плейбука лежат в своих каталогах', () => {
		store.appendChat('c-s1', mkMsg('a'))
		store.appendChat('c-s1', mkMsg('b'))
		store.appendChat('p-aff', mkMsg('c'))
		assert.deepEqual(store.loadChat('c-s1', 10).map(m => m.id), ['a', 'b'])
		assert.deepEqual(store.loadChat('c-s1', 1).map(m => m.id), ['b'])
		assert.deepEqual(store.loadChat('p-aff', 10).map(m => m.id), ['c'])
		assert.ok(fs.existsSync(path.join(home, 'cases', 'c-s1', 'chat.jsonl')))
		assert.ok(fs.existsSync(path.join(home, 'playbooks', 'p-aff', 'chat.jsonl')))
		assert.throws(() => store.loadChat('x-1', 10))
	})

	it('публикация плагина: два плейбука, один, пусто', () => {
		store.publish([{ id: 'p-aff', files: { 'SKILL.md': 'A', 'refs/r.md': 'R' } }, { id: 'p-bee', files: { 'SKILL.md': 'B' } }], '1.2.3')
		const meta: unknown = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
		assert.deepEqual(meta, { name: 'nessy-playbooks', version: '1.2.3', description: 'Playbooks learned by nessy-orch from past sessions' })
		assert.equal(fs.readFileSync(path.join(pluginDir, 'skills', 'p-aff', 'SKILL.md'), 'utf8'), 'A')
		assert.equal(fs.readFileSync(path.join(pluginDir, 'skills', 'p-aff', 'refs', 'r.md'), 'utf8'), 'R')
		assert.equal(fs.readFileSync(path.join(pluginDir, 'skills', 'p-bee', 'SKILL.md'), 'utf8'), 'B')

		store.publish([{ id: 'p-aff', files: { 'SKILL.md': 'A2' } }], '1.2.4')
		assert.ok(!fs.existsSync(path.join(pluginDir, 'skills', 'p-bee')))
		assert.equal(fs.readFileSync(path.join(pluginDir, 'skills', 'p-aff', 'SKILL.md'), 'utf8'), 'A2')
		assert.ok(!fs.existsSync(stage('.tmp')) && !fs.existsSync(stage('.old')))
		assert.deepEqual(fs.readdirSync(path.dirname(pluginDir)), ['nessy-playbooks'])

		store.publish([], '1.2.5')
		assert.ok(!fs.existsSync(pluginDir))
	})

	it('сбой публикации оставляет прежний плагин', () => {
		console.error = () => {}
		store.publish([{ id: 'p-aff', files: { 'SKILL.md': 'A' } }], '1')
		store.publish([{ id: 'p-aff', files: { '../x': 'bad' } }], '2')
		assert.equal(fs.readFileSync(path.join(pluginDir, 'skills', 'p-aff', 'SKILL.md'), 'utf8'), 'A')
		assert.ok(!fs.existsSync(stage('.tmp')))
		assert.deepEqual(fs.readdirSync(path.dirname(pluginDir)), ['nessy-playbooks'])
	})
})
