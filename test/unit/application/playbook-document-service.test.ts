import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { Hub } from '../../../src/application/hub'
import type { PlaybookState } from '../../../src/application/learning/learning.types'
import { PlaybookService } from '../../../src/application/learning/playbook.service'
import { AppError } from '../../../src/domain/errors'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

describe('PlaybookService: документ плейбука', () => {
	let store: MemoryPlaybookStore
	let svc: PlaybookService
	let n = 0
	const known = new Set(['c1', 'c2', 'c3'])
	beforeEach(() => {
		store = new MemoryPlaybookStore()
		n = 0
		const p: PlaybookState = { ...samplePlaybook(), verdicts: {}, rejectedEdits: [], reviewAttempts: 0 }
		store.snapshots.set(p.id, [{ state: p, files: {}, ts: '2026-10-01T00:00:00Z', message: 'init' }])
		svc = new PlaybookService({
			store,
			hub: new Hub(),
			clock: { now: () => Date.parse('2026-10-22T00:00:00Z') },
			ids: { next: () => `i${++n}abcde`.slice(0, 6) },
		})
		svc.load()
	})
	const md = (): string => svc.detail('p-1').markdown

	it('detail.markdown — канонический документ', () => {
		assert.match(md(), /^---\nname: aff-package\n/)
		assert.match(md(), /^- Run lint <!-- r1 stage:2 -->$/m)
	})

	it('правка текста правила сохраняет счётчики и доказательства', () => {
		const next = svc.applyDocument('p-1', md().replace('- Run lint <!--', '- Run lint and tests <!--'), 1, known)
		const r = next.rules.find(x => x.id === 'r1')
		assert.deepEqual([r?.text, r?.up, r?.down, r?.evidence.length, next.version], ['Run lint and tests', 3, 1, 2, 2])
		assert.equal(store.journal.filter(e => e.kind === 'edit').at(-1)?.revertible, true)
	})

	it('удаление маркера архивирует правило; строка без маркера — новое активное правило user с журналом', () => {
		const text = md()
			.replace(/^- Maybe <!-- r2 -->\n/m, '')
			.replace('## Rules\n', '## Rules\n- Brand new\n')
		const next = svc.applyDocument('p-1', text, 1, known)
		assert.equal(next.rules.find(r => r.id === 'r2')?.status, 'archived')
		const fresh = next.rules.find(r => r.text === 'Brand new')
		assert.deepEqual([fresh?.status, fresh?.up, fresh?.down, fresh?.author], ['active', 2, 0, 'user'])
		assert.ok(store.journal.some(e => e.kind === 'rule_activated' && e.summary.includes('добавлено вручную')))
		assert.ok(store.journal.some(e => e.kind === 'rule_archived'))
		assert.doesNotMatch(svc.detail('p-1').markdown, /Maybe/)
	})

	it('stale: baseVersion не совпала — 409 с версией, плейбук не меняется', () => {
		assert.throws(
			() => svc.applyDocument('p-1', md(), 5, known),
			(e: unknown) => e instanceof AppError && e.status === 409 && e.code === 'stale' && e.extra?.['version'] === 1,
		)
		assert.equal(svc.get('p-1')?.version, 1)
	})

	it('lint: пустой description и описание без «Use when» — 400 lint', () => {
		assert.throws(
			() => svc.applyDocument('p-1', md().replace(/^description: .*$/m, 'description: ""'), 1, known),
			(e: unknown) => e instanceof AppError && e.status === 400 && e.code === 'lint' && e.message.includes('description'),
		)
		assert.throws(() => svc.applyDocument('p-1', md().replace('Use when implementing', 'Implementing'), 1, known), { code: 'lint', status: 400 })
		assert.throws(() => svc.applyDocument('p-x', md(), 1, known), { code: 'no_playbook', status: 404 })
		assert.equal(svc.get('p-1')?.version, 1)
	})

	it('заметки из ## Notes и незнакомые разделы уходят в notes.md', () => {
		svc.applyDocument('p-1', md().replace(/## Notes\n[\s\S]*$/, '## Notes\nmy note\n\n## Extra\nkept\n'), 1, known)
		assert.equal(store.readNotes('p-1'), 'my note\n\n## Extra\nkept')
	})
})
