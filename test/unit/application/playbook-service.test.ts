/** PlaybookService: создание, статусы и публикация, откат решений и версий. */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, JournalEntry } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { PlaybookService } from '../../../src/application/learning/playbook.service'
import type { BuildDraft, MatchGroup } from '../../../src/domain/playbook.types'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const draft = (): BuildDraft => {
	const s = samplePlaybook()
	return {
		title: s.title,
		description: s.description,
		taskType: 'aff',
		cases: ['c1', 'c2', 'c3'],
		heldOut: null,
		params: s.params,
		sources: s.sources,
		files: s.files,
		behavior: s.behavior,
		stages: s.stages,
		rules: [
			{ text: 'Run lint', stage: 2, evidence: [{ caseId: 'c1', anchor: 'n 1' }, { caseId: 'c2', anchor: 'n 2' }] },
			{ text: 'One case only', stage: null, evidence: [{ caseId: 'c1', anchor: 'n 3' }] },
		],
	}
}
const group: MatchGroup = { task: 'aff', taskType: 'aff', playbookId: null, cases: [] }

describe('PlaybookService', () => {
	let store: MemoryPlaybookStore
	let events: HubEvent[]
	let svc: PlaybookService
	let n: number
	const editEntry = (): JournalEntry => {
		const e = store.journal.find(x => x.kind === 'edit')
		assert.ok(e)
		return e
	}
	const published = (): string[] => (store.published?.active ?? []).map(a => a.id)

	beforeEach(() => {
		store = new MemoryPlaybookStore()
		const hub = new Hub()
		events = []
		hub.subscribe(e => events.push(e))
		n = 0
		const clock = { now: () => Date.parse('2026-10-01T10:00:00Z') + n++ * 1000 }
		svc = new PlaybookService({ store, hub, clock, ids: { next: () => `i${n++}` } })
	})

	it('create: draft, id p-…, имя = id, правила active/candidate, журнал, файлы и события', () => {
		const p = svc.create(draft(), group, 'c3')
		assert.equal(p.status, 'draft')
		assert.equal(p.id, 'p-aff')
		assert.equal(p.name, p.id)
		assert.equal(p.version, 1)
		assert.equal(p.heldOut, 'c3')
		assert.deepEqual(p.rules.map(r => [r.status, r.up, r.down]), [['active', 2, 0], ['candidate', 2, 0]])
		assert.ok(store.readFiles('p-aff')['SKILL.md']?.includes('name: p-aff'))
		assert.equal(store.journal[0]?.kind, 'playbook_created')
		assert.ok(events.some(e => e.t === 'learning_playbook'))
		assert.ok(events.some(e => e.t === 'learning_journal'))
		assert.equal(store.publishCalls, 0)
		// занятое имя получает суффикс
		assert.equal(svc.create(draft(), group, null).id, 'p-aff-2')
	})

	it('setStatus active публикует, disabled убирает из публикации', () => {
		svc.create(draft(), group, null)
		svc.setStatus('p-aff', 'active', 'ревью прошло')
		assert.deepEqual(published(), ['p-aff'])
		assert.equal(store.published?.version, '1.0.1')
		svc.setStatus('p-aff', 'disabled', 'вручную')
		assert.deepEqual(published(), [])
		// trial тоже публикуется
		svc.setStatus('p-aff', 'trial', 'пробный режим')
		assert.deepEqual(published(), ['p-aff'])
	})

	it('pluginVersion задаёт версию плагина', () => {
		const s = new PlaybookService({ store, hub: new Hub(), clock: { now: () => 1 }, ids: { next: () => 'x' }, pluginVersion: () => '9.9.9' })
		s.create(draft(), group, null)
		s.setStatus('p-aff', 'active', 'r')
		assert.equal(store.published?.version, '9.9.9')
	})

	it('revert записи published: прежний статус и публикация', () => {
		svc.create(draft(), group, null)
		svc.setStatus('p-aff', 'active', 'ревью прошло')
		const entry = store.journal.find(e => e.kind === 'published')
		assert.ok(entry)
		assert.ok(entry.revertible)
		const back = svc.revert(entry.id)
		assert.equal(back.kind, 'reverted')
		assert.equal(svc.get('p-aff')?.status, 'draft')
		assert.deepEqual(published(), [])
		assert.equal(store.journal.find(e => e.id === entry.id)?.revertedBy, back.id)
		assert.throws(() => svc.revert(entry.id), { code: 'already_reverted' })
		assert.throws(() => svc.revert(back.id), { code: 'not_revertible' })
		assert.throws(() => svc.revert('нет'), { code: 'no_journal' })
	})

	it('revert версии: файлы прежней версии, версия растёт, заметки сохраняются', () => {
		const p = svc.create(draft(), group, null)
		svc.setNotes('p-aff', 'мои заметки')
		const changed = { ...p, description: 'Use when something else entirely' }
		const v2 = svc.saveVersion(changed, 'Правка описания', { kind: 'edit', subject: 'p-aff', summary: 'Правка описания', report: null, revertible: true, revertedBy: null })
		assert.equal(v2.version, 2)
		assert.ok(store.readFiles('p-aff')['SKILL.md']?.includes('something else'))
		svc.revert(editEntry().id)
		const now = svc.get('p-aff')
		assert.equal(now?.version, 3)
		assert.equal(now.description, p.description)
		const files = store.readFiles('p-aff')
		assert.ok(files['SKILL.md']?.includes('implementing an aff package'))
		assert.ok(!files['SKILL.md']?.includes('something else'))
		assert.equal(files['notes.md'], 'мои заметки')
		assert.ok(files['CHANGELOG.md']?.includes('## v3'))
	})

	it('revert правила: прежний статус правила', () => {
		const p = svc.create(draft(), group, null)
		const rule = p.rules[1]
		assert.ok(rule)
		assert.equal(rule.status, 'candidate')
		svc.setRuleStatus('p-aff', rule.id, 'active', 'судья')
		assert.equal(svc.get('p-aff')?.rules[1]?.status, 'active')
		const e = store.journal.find(x => x.kind === 'rule_activated')
		svc.revert(e?.id ?? '')
		assert.equal(svc.get('p-aff')?.rules[1]?.status, 'candidate')
	})

	it('сбой git: состояние не меняется, исключение наружу', () => {
		svc.create(draft(), group, null)
		store.failSave = true
		assert.throws(() => svc.setStatus('p-aff', 'active', 'r'), /git/)
		assert.equal(svc.get('p-aff')?.status, 'draft')
	})

	it('remove, detail, load, notes, forCase', () => {
		const withCase = new PlaybookService({ store, hub: new Hub(), clock: { now: () => 1 }, ids: { next: () => 'x' }, caseOf: id => (id === 'c9' ? { playbook: 'p-aff@1' } : null) })
		withCase.create(draft(), group, null)
		assert.equal(withCase.forCase('c9')?.id, 'p-aff')
		assert.equal(withCase.forCase('c8'), null)
		const d = withCase.detail('p-aff')
		assert.equal(d.versions.length, 1)
		assert.ok(d.changelog.includes('v1'))
		const fresh = new PlaybookService({ store, hub: new Hub(), clock: { now: () => 1 }, ids: { next: () => 'x' } })
		fresh.load()
		assert.equal(fresh.list().length, 1)
		fresh.remove('p-aff')
		assert.equal(fresh.get('p-aff'), null)
		assert.throws(() => fresh.detail('p-aff'), { code: 'no_playbook' })
	})
})
