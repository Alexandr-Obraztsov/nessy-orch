import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { findTranscript, scanTranscripts } from '../../../src/infrastructure/persistence/transcript-scan'

const user = (text: string): string => JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: text } })
const bash = (command: string): string =>
	JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-01T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }] } })

describe('scanTranscripts', () => {
	let dir = ''
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-scan-'))
		for (const p of ['p1', 'p2']) fs.mkdirSync(path.join(dir, p))
	})
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	it('берёт только файлы с nessy-orch spawn|send и без известных чатов', () => {
		const long = 'я'.repeat(200)
		fs.writeFileSync(path.join(dir, 'p1', 'chat-a.jsonl'), [user(`${long}\nвторая строка`), bash('nessy-orch spawn --role x "работа"')].join('\n') + '\n')
		fs.writeFileSync(path.join(dir, 'p1', 'chat-b.jsonl'), [user('без вызовов'), bash('ls -la')].join('\n') + '\n')
		fs.writeFileSync(path.join(dir, 'p2', 'chat-known.jsonl'), [user('известный'), bash('nessy-orch send a "x"')].join('\n') + '\n')
		fs.writeFileSync(path.join(dir, 'p2', 'notes.txt'), 'nessy-orch spawn')
		const list = scanTranscripts(dir, new Set(['chat-known']))
		assert.equal(list.length, 1)
		const c = list[0]
		assert.equal(c?.kind, 'transcript')
		assert.equal(c.id, 'chat-a')
		assert.equal(c.title.length, 80)
		assert.ok(c.title.endsWith('…'))
		assert.equal(c.size, fs.statSync(path.join(dir, 'p1', 'chat-a.jsonl')).size)
		assert.ok(!Number.isNaN(Date.parse(c.date)))
		assert.equal(findTranscript(dir, 'chat-a'), path.join(dir, 'p1', 'chat-a.jsonl'))
		assert.equal(findTranscript(dir, 'нет'), null)
	})

	it('вызов на границе куска чтения находится; нет каталога — пусто', () => {
		const pad = 'x'.repeat(64 * 1024 - 8)
		fs.writeFileSync(path.join(dir, 'p1', 'edge.jsonl'), `${user('привет')}\n${pad}nessy-orch spawn\n`)
		assert.equal(scanTranscripts(dir, new Set()).length, 1)
		assert.deepEqual(scanTranscripts(path.join(dir, 'нет'), new Set()), [])
	})
})
