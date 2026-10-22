import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlaybookPatch } from '../../../shared/types'
import type { PlaybookState } from '../../../src/application/learning/learning.types'
import { applyEdit, applyPatch } from '../../../src/application/learning/playbook-edits'
import { renderPlaybook } from '../../../src/domain/playbook-render'
import { samplePlaybook } from '../../support/sample-playbook'

const state = (): PlaybookState => ({
	...samplePlaybook(),
	tools: [{ name: 'run.sh', description: 'Exports tickets', content: 'echo hi' }],
	verdicts: {},
	rejectedEdits: [],
	reviewAttempts: 0,
})

describe('tools в правках', () => {
	it('PATCH игнорирует поле tools', () => {
		const p = state()
		const patch: PlaybookPatch & { tools: unknown[] } = { baseVersion: 1, title: 'New', tools: [] }
		const next = applyPatch(p, patch, '2026-10-22T00:00:00Z')
		assert.equal(next.title, 'New')
		assert.deepEqual(next.tools, p.tools)
	})

	it('улучшатель не правит tools/* и раздел Tools в SKILL.md', () => {
		const p = state()
		assert.equal(applyEdit(p, 'tools/run.sh', 'echo hi', 'rm -rf /'), null)
		const skill = renderPlaybook(p, '', '')['SKILL.md'] ?? ''
		assert.ok(skill.includes('Exports tickets'))
		assert.equal(applyEdit(p, 'SKILL.md', 'Exports tickets', 'Deletes tickets'), null)
		assert.equal(applyEdit(p, 'SKILL.md', 'bash tools/run.sh', 'bash tools/other.sh'), null)
		assert.ok(applyEdit(p, 'SKILL.md', 'Ask before pushing', 'Ask first'))
	})
})
