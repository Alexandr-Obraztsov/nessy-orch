import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildToolOutput, extractToolContent, stringifyUnknown } from '../../../src/infrastructure/nessy/tool-output'

const text = (t: string): unknown => ({ type: 'content', content: { type: 'text', text: t } })

describe('вывод инструмента (rawOutput + content)', () => {
	it('rawOutput пустой, текст в content', () => {
		assert.equal(buildToolOutput('', [text('hello')]), 'hello')
	})
	it('rawOutput есть, content пустой', () => {
		assert.equal(buildToolOutput('raw', []), 'raw')
	})
	it('дубликаты убираются: короткая часть внутри длинной', () => {
		assert.equal(buildToolOutput('hello', [text('hello world')]), 'hello world')
		assert.equal(buildToolOutput('same', [text('same')]), 'same')
	})
	it('разные части склеиваются через пустую строку', () => {
		assert.equal(buildToolOutput('a', [text('b')]), 'a\n\nb')
	})
	it('rawOutput-объект сериализуется', () => {
		assert.equal(buildToolOutput({ ok: true }, []), '{\n  "ok": true\n}')
	})
	it('diff и terminal не дедуплицируются', () => {
		const diff = { type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' }
		assert.equal(extractToolContent(diff), 'Diff: a.ts\n--- old\nx\n+++ new\ny')
		assert.equal(extractToolContent({ type: 'diff', path: 'n.ts', newText: 'z' }), 'Diff: n.ts\n+++ new\nz')
		assert.equal(extractToolContent({ type: 'terminal', terminalId: 't1' }), 'Terminal: t1')
		assert.equal(buildToolOutput('', [{ type: 'terminal', terminalId: 't1' }, { type: 'terminal', terminalId: 't1' }]), 'Terminal: t1\n\nTerminal: t1')
	})
	it('неизвестное содержимое', () => {
		assert.equal(extractToolContent({ type: 'content', content: { type: 'image', data: 'b64' } }), '{\n  "type": "image",\n  "data": "b64"\n}')
		assert.equal(extractToolContent({ type: 'unknown' }), '')
		assert.equal(extractToolContent(null), '')
		assert.equal(stringifyUnknown(undefined), '')
	})
})
