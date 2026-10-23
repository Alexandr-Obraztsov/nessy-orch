import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { buildCollectorPrompt } from '../../../src/domain/collector'
import type { CollectorInput } from '../../../src/domain/learning.types'

const template = 'SESSION COLLECTOR {{case_id}}|{{session_title}}|{{summary}}|{{notes}}|{{total}}|{{mode}}'
const input: CollectorInput = {
	caseId: 'c1',
	sessionTitle: 'Релиз  пакета',
	summary: '# S',
	notes: 'ignore X',
	total: 7,
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
		assert.equal(p, 'SESSION COLLECTOR c1|Релиз пакета|# S|ignore X|7|incremental: update only what the new events change')
	})
	it('режим final и пустое описание', () => {
		const p = buildCollectorPrompt(template, { ...input, summary: '  ', final: true })
		assert.match(p, /\(empty — start a new summary\)/)
		assert.match(p, /final: finish every section, the session has ended/)
	})
	it('плейсхолдеры внутри данных не подставляются повторно', () => {
		const p = buildCollectorPrompt(template, { ...input, notes: '{{total}}' })
		assert.match(p, /\|\{\{total\}\}\|/)
	})
	it('реальный шаблон: маркер в первой строке и все плейсхолдеры', () => {
		const t = readFileSync(join(repoRoot(), 'learning', 'prompts', 'session-collector.md'), 'utf8')
		assert.match(t.split('\n').slice(0, 2).join('\n'), /SESSION COLLECTOR/)
		for (const k of ['case_id', 'session_title', 'summary', 'notes', 'total', 'mode', 'block_events', 'max_attempts']) assert.ok(t.includes(`{{${k}}}`), k)
		assert.match(buildCollectorPrompt(t, input), /SESSION COLLECTOR/)
		assert.doesNotMatch(buildCollectorPrompt(t, input), /\{\{\w+\}\}/)
		assert.doesNotMatch(t, /\{\{(events|range)\}\}/)
		// первая строка описания — название сессии как есть; <meta> без title
		assert.match(buildCollectorPrompt(t, input), /^# Релиз пакета$/m)
		assert.doesNotMatch(t, /"title": "<session title>"/)
		assert.match(t, /nessy-orch case read/)
		assert.match(t, /nessy-orch case draft/)
		assert.match(t, /case draft \{\{case_id\}\} --final/)
		// строгий протокол: gate, таблица отговорок, рефлексия, «отброшенное с причиной», статус для журнала
		assert.match(t, /NO BLOCK IS CLOSED WITHOUT AN ACCEPTED SUMMARY/)
		assert.match(t, /A rejected draft is not a draft/)
		assert.match(t, /Excuse → Reality/)
		assert.match(t, /why it failed → what I change/)
		assert.match(t, /### Skipped/)
		assert.match(t, /DONE_WITH_CONCERNS/)
		assert.doesNotMatch(t, /<summary>|<meta>/)
		const built = buildCollectorPrompt(t, { ...input, blockEvents: 25 })
		assert.match(built, /at most 25 events/)
		assert.match(buildCollectorPrompt(t, input), /at most 80 events/) // умолчание настройки blockEvents
		assert.match(built, /attempt N\/3/)
	})
})
