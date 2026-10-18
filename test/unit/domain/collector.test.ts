import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { buildCollectorPrompt, parseCollectorReply } from '../../../src/domain/collector'
import type { CollectorInput } from '../../../src/domain/learning.types'

const template = 'SESSION COLLECTOR {{case_id}}|{{summary}}|{{notes}}|{{events}}|{{range}}|{{mode}}'
const input: CollectorInput = {
	caseId: 'c1',
	summary: '# S',
	notes: 'ignore X',
	portion: { text: '[3] hi', from: 3, until: 7 },
	final: false,
}

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

describe('buildCollectorPrompt', () => {
	it('подставляет всё и режим incremental', () => {
		const p = buildCollectorPrompt(template, input)
		assert.equal(p, 'SESSION COLLECTOR c1|# S|ignore X|[3] hi|n 3–7|incremental: update only what the new events change')
	})
	it('режим final и пустое описание', () => {
		const p = buildCollectorPrompt(template, { ...input, summary: '  ', final: true })
		assert.match(p, /\(empty — start a new summary\)/)
		assert.match(p, /final: finish every section, the session has ended/)
	})
	it('плейсхолдеры внутри данных не подставляются повторно', () => {
		const p = buildCollectorPrompt(template, { ...input, notes: '{{events}}' })
		assert.match(p, /\|\{\{events\}\}\|/)
	})
	it('реальный шаблон: маркер в первой строке и все плейсхолдеры', () => {
		const t = readFileSync(join(repoRoot(), 'learning', 'prompts', 'session-collector.md'), 'utf8')
		assert.match(t.split('\n').slice(0, 2).join('\n'), /SESSION COLLECTOR/)
		for (const k of ['case_id', 'summary', 'notes', 'events', 'range', 'mode']) assert.ok(t.includes(`{{${k}}}`), k)
		assert.match(buildCollectorPrompt(t, input), /SESSION COLLECTOR/)
		assert.doesNotMatch(buildCollectorPrompt(t, input), /\{\{\w+\}\}/)
	})
})

describe('parseCollectorReply', () => {
	it('берёт последний summary и обрезает пробелы', () => {
		const r = parseCollectorReply('<summary>old</summary>\n<summary>\n  # New\n</summary>\n<meta>{"title":"T","goals":[{"title":"G","type":"fix bug"}]}</meta>')
		assert.deepEqual(r, { summary: '# New', title: 'T', goals: [{ title: 'G', type: 'fix bug' }] })
	})
	it('нет блока или пустой — null', () => {
		assert.equal(parseCollectorReply('просто текст'), null)
		assert.equal(parseCollectorReply('<summary>  \n </summary>'), null)
	})
	it('битый или отсутствующий meta', () => {
		assert.deepEqual(parseCollectorReply('<summary>S</summary><meta>{oops</meta>'), { summary: 'S', title: null, goals: [] })
		assert.deepEqual(parseCollectorReply('<summary>S</summary>'), { summary: 'S', title: null, goals: [] })
	})
	it('цели без title выброшены', () => {
		const r = parseCollectorReply('<summary>S</summary><meta>{"title":"T","goals":[{"type":"x"},{"title":"  "},{"title":"G"}, 5]}</meta>')
		assert.deepEqual(r?.goals, [{ title: 'G', type: '' }])
	})
})
