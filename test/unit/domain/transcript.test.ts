import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseTranscript } from '../../../src/domain/transcript'

/** Образец лежит в исходном test/, tsc его не копирует: ищем вверх от каталога теста (работает из dist/ и из любого outDir). */
function fixture(): string {
	const rel = path.join('test', 'fixtures', 'transcripts', 'basic.jsonl')
	for (const start of [__dirname, process.cwd()]) {
		for (let dir = start; ; dir = path.dirname(dir)) {
			const file = path.join(dir, rel)
			if (existsSync(file)) return readFileSync(file, 'utf8')
			if (path.dirname(dir) === dir) break
		}
	}
	throw new Error('нет образца basic.jsonl')
}

const at = <T>(a: readonly T[], i: number): T => {
	const v = a[i]
	if (v === undefined) throw new Error(`нет элемента ${i}`)
	return v
}

describe('parseTranscript', () => {
	it('без вызовов nessy: user и claude, служебное пропущено', () => {
		const e = parseTranscript(fixture(), { nessyCalls: false })
		assert.deepEqual(e.map(x => x.kind), ['user', 'claude'])
		assert.equal(at(e, 0).text, 'Собери данные по ТЗ-1')
		assert.equal(at(e, 0).uuid, 'u1')
		assert.equal(at(e, 0).ts, Date.parse('2026-10-01T10:00:00.000Z'))
		assert.equal(at(e, 1).text, 'Запускаю агента.\nСначала осмотрюсь.')
	})
	it('с вызовами nessy: вызов с результатом одной записью, Bash без nessy-orch не попадает', () => {
		const e = parseTranscript(fixture(), { nessyCalls: true })
		assert.deepEqual(e.map(x => x.kind), ['user', 'claude', 'call'])
		assert.equal(at(e, 2).text, '$ nessy-orch spawn --role explorer --name e1 "изучи репозиторий"\nСтатус: DONE — всё найдено')
		assert.ok(!e.some(x => x.text.includes('ls -la')))
	})
	it('результат строкой', () => {
		const lines = [
			{ type: 'assistant', uuid: 'a', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'nessy-orch wait e1' } }] } },
			{ type: 'user', uuid: 'b', timestamp: '2026-10-01T10:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'готово' }] } },
		].map(r => JSON.stringify(r)).join('\n')
		const e = parseTranscript(lines, { nessyCalls: true })
		assert.equal(e.length, 1)
		assert.equal(at(e, 0).text, '$ nessy-orch wait e1\nготово')
	})
	it('пустой и мусорный вход — пустой результат', () => {
		assert.deepEqual(parseTranscript('', { nessyCalls: true }), [])
		assert.deepEqual(parseTranscript('не json\n[1]\n', { nessyCalls: true }), [])
	})
	it('вызов Skill — запись skill независимо от nessyCalls', () => {
		const lines = [
			{ type: 'assistant', uuid: 'a', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'x', name: 'Skill', input: { skill: 'nessy-playbooks:pb-1', args: 'foo' } }] } },
			{ type: 'assistant', uuid: 'b', timestamp: '2026-10-01T10:00:01Z', message: { content: [{ type: 'tool_use', id: 'y', name: 'Skill', input: { command: 'old-style' } }] } },
			{ type: 'assistant', uuid: 'c', timestamp: '2026-10-01T10:00:02Z', message: { content: [{ type: 'tool_use', id: 'z', name: 'Skill', input: {} }] } },
		].map(r => JSON.stringify(r)).join('\n')
		for (const nessyCalls of [false, true]) {
			const e = parseTranscript(lines, { nessyCalls })
			assert.deepEqual(e.map(x => [x.kind, x.text]), [['skill', 'nessy-playbooks:pb-1'], ['skill', 'old-style']])
			assert.equal(at(e, 0).uuid, 'a:x')
		}
	})
})
