import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fillPrompt, placeholders } from '../../../src/domain/learning-replies'

/** Корень репозитория: вверх от теста (из dist/) или от cwd (при нестандартном outDir). */
function repoRoot(): string {
	for (const start of [__dirname, process.cwd()]) {
		let dir = start
		for (;;) {
			if (existsSync(join(dir, 'learning', 'prompts', 'session-collector.md'))) return dir
			const up = dirname(dir)
			if (up === dir) break
			dir = up
		}
	}
	throw new Error('корень репозитория не найден')
}

const PROMPTS: Record<string, { marker: string; vars: string[] }> = {
	matcher: { marker: 'PLAYBOOK MATCHER', vars: ['new_case', 'playbooks', 'other_cases', 'hints'] },
	'group-verifier': { marker: 'GROUP VERIFIER', vars: ['group'] },
	'case-analyst': { marker: 'CASE ANALYST', vars: ['case_id', 'events', 'summary'] },
	'playbook-builder': { marker: 'PLAYBOOK BUILDER', vars: ['group', 'existing_playbook', 'materials', 'notes', 'existing'] },
	judge: { marker: 'RULE JUDGE', vars: ['rules', 'summary', 'events'] },
	improver: { marker: 'PLAYBOOK IMPROVER', vars: ['playbook', 'summary', 'events', 'rejected', 'notes'] },
	editor: { marker: 'PLAYBOOK EDITOR', vars: ['object', 'files', 'message', 'notes'] },
	grader: { marker: 'PLAYBOOK GRADER', vars: ['playbook', 'evidence'] },
	reviewer: { marker: 'PLAYBOOK REVIEWER', vars: ['playbook', 'cases'] },
	consistency: { marker: 'PLAYBOOK CONSISTENCY', vars: ['playbook', 'others', 'notes', 'duplicates'] },
	planner: { marker: 'TASK PLANNER', vars: ['task', 'playbook'] },
	comparator: { marker: 'BLIND COMPARATOR', vars: ['task', 'accepted', 'plan_a', 'plan_b'] },
	selector: { marker: 'PLAYBOOK SELECTOR', vars: ['playbooks', 'message'] },
	'description-improver': { marker: 'DESCRIPTION IMPROVER', vars: ['playbook', 'misses', 'history'] },
}

const root = repoRoot()
const read = (name: string): string => readFileSync(join(root, 'learning', 'prompts', `${name}.md`), 'utf8')

describe('промпты фоновых агентов', () => {
	for (const [name, spec] of Object.entries(PROMPTS)) {
		describe(name, () => {
			const text = read(name)
			it('первая строка — маркер', () => {
				assert.equal(text.split('\n')[0], `# ${spec.marker}`)
			})
			it('все свои плейсхолдеры и ни одного чужого', () => {
				assert.deepEqual(placeholders(text).sort(), [...spec.vars].sort())
			})
			it('требует один блок result', () => {
				assert.match(text, /<result>/)
				assert.match(text, /Итог \/ Детали \/ Источники \/ Не проверено \/ Статус:/)
			})
			it('заполняется без остатка плейсхолдеров', () => {
				const vars = Object.fromEntries(spec.vars.map(v => [v, `<<${v}>>`]))
				const filled = fillPrompt(text, vars)
				assert.equal(placeholders(filled).filter(p => !spec.vars.includes(p)).length, 0)
				assert.ok(!/\{\{[a-z_]+\}\}/.test(filled))
			})
		})
	}

	it('сторонние промпты имеют шапку с источником и лицензией после маркера', () => {
		for (const name of ['grader', 'comparator', 'reviewer', 'consistency', 'description-improver', 'selector']) {
			const lines = read(name).split('\n')
			assert.match(lines[2] ?? '', /^<!-- Source: .*License: (Apache-2\.0|MIT);.*changes: .*-->$/, name)
		}
	})

	it('судья описывает три вердикта, builder — схему BuildDraft', () => {
		const judge = read('judge')
		for (const v of ['applied', 'violated_by_user_correction', 'not_applicable']) assert.match(judge, new RegExp(v))
		const builder = read('playbook-builder')
		for (const f of ['"title"', '"description"', '"taskType"', '"cases"', '"heldOut"', '"params"', '"sources"', '"files"', '"behavior"', '"stages"', '"rules"', '"evidence"']) {
			assert.ok(builder.includes(f), f)
		}
	})
})

describe('fillPrompt', () => {
	it('подставляет за один проход и не раскрывает плейсхолдеры внутри данных', () => {
		const out = fillPrompt('A {{x}} B {{y}}', { x: '{{y}}', y: 'Y' })
		assert.equal(out, 'A {{y}} B Y')
	})
	it('неизвестный плейсхолдер — ошибка', () => {
		assert.throws(() => fillPrompt('{{nope}}', {}), /nope/)
	})
})
