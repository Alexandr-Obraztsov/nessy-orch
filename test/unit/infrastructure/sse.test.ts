import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatFrame } from '../../../src/infrastructure/sse/sse-format'
import { parseFrame, SseParser } from '../../../src/infrastructure/sse/sse-parser'
import type { SseFrame } from '../../../src/infrastructure/sse/sse.types'

describe('SSE', () => {
	it('разбирает кадры, разбитые на произвольные куски', () => {
		const got: SseFrame[] = []
		const p = new SseParser(f => got.push(f))
		const raw = formatFrame({ a: 1 }, { id: 7, event: 'x' }) + ': hb\n\n' + formatFrame({ b: 2 })
		for (const ch of raw) p.push(ch)
		assert.equal(got.length, 2)
		assert.deepEqual(got[0], { id: '7', event: 'x', data: '{"a":1}' })
		assert.deepEqual(got[1], { id: null, event: 'message', data: '{"b":2}' })
	})
	it('CRLF, многострочный data, поле без значения', () => {
		const got: SseFrame[] = []
		const p = new SseParser(f => got.push(f))
		p.push('id: 1\r\ndata: a\r\ndata: b\r\n\r\nevent\n\n')
		assert.deepEqual(got[0], { id: '1', event: 'message', data: 'a\nb' })
		assert.deepEqual(got[1], { id: null, event: '', data: '' })
	})
	it('комментарии и пустые кадры игнорируются', () => {
		assert.equal(parseFrame(': ping'), null)
		assert.equal(parseFrame(''), null)
	})
	it('formatFrame без id/event', () => {
		assert.equal(formatFrame('x'), 'data: "x"\n\n')
	})
})
