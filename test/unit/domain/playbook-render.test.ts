import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { samplePlaybook } from '../../support/sample-playbook'
import { addChangelog, renderPlaybook, skillName } from '../../../src/domain/playbook-render'

describe('playbook-render', () => {
	it('skillName: kebab, до 64', () => {
		assert.equal(skillName('P Aff Package!'), 'p-aff-package')
		assert.equal(skillName('Ж'), 'playbook')
		assert.ok(skillName('a'.repeat(100)).length <= 64)
	})

	it('шесть файлов с ожидаемыми заголовками', () => {
		const f = renderPlaybook(samplePlaybook(), 'my notes', '')
		assert.deepEqual(Object.keys(f).sort(), ['CHANGELOG.md', 'SKILL.md', 'notes.md', 'rules.md', 'stages/01-research.md', 'stages/02-implement.md'])
		const s = f['SKILL.md'] ?? ''
		assert.match(s, /^---\nname: aff-package\ndescription: "Use when implementing/)
		for (const h of ['## Parameters', '## Sources', '## Key files', '## Steps', '## Behavior', '## Rules', '## Notes']) assert.ok(s.includes(h), h)
		assert.ok(s.includes('[Research](stages/01-research.md)'))
		assert.ok(s.includes('`{package}`'))
		assert.equal(f['notes.md'], 'my notes')
	})

	it('tools: файлы tools/<name> и раздел Tools в SKILL.md; без инструментов раздела нет', () => {
		assert.ok(!(renderPlaybook(samplePlaybook(), '', '')['SKILL.md'] ?? '').includes('## Tools'))
		const p = { ...samplePlaybook(), tools: [{ name: 'export.sh', description: 'Exports tickets', content: 'echo hi\n' }] }
		const f = renderPlaybook(p, '', '')
		assert.equal(f['tools/export.sh'], 'echo hi\n')
		const s = f['SKILL.md'] ?? ''
		assert.ok(s.includes('## Tools'))
		assert.ok(s.includes('`export.sh` — Exports tickets. Run: `bash tools/export.sh`'))
	})

	it('гейт и шаблон в этапе; забор длиннее внутреннего', () => {
		const f = renderPlaybook(samplePlaybook(), '', '')
		assert.ok(!(f['stages/01-research.md'] ?? '').includes('Show the user before continuing'))
		const st = f['stages/02-implement.md'] ?? ''
		assert.ok(st.includes('## Show the user before continuing'))
		assert.ok(st.includes('## Done when\ntests pass'))
		assert.ok(st.includes('````\nCode with ```x``` fence\n````'))
	})

	it('rules.md только активные, со счётчиками и ссылками', () => {
		const r = renderPlaybook(samplePlaybook(), '', '')['rules.md'] ?? ''
		assert.ok(r.includes('Run lint (stage 2) ▲3 ▼1 — c1 n 12–15; c2 n 3'))
		assert.ok(!r.includes('Maybe'))
	})

	it('addChangelog: новая запись сверху', () => {
		const a = addChangelog('', 1, '2026-10-18', ['created'])
		assert.equal(a, '# Changelog\n\n## v1 — 2026-10-18\n- created\n')
		const b = addChangelog(a, 2, '2026-10-19', ['rule added', 'edit'])
		assert.ok(b.indexOf('## v2') < b.indexOf('## v1'))
		assert.ok(b.startsWith('# Changelog\n'))
	})
})
