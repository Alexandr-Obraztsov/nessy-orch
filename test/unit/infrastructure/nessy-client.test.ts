import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { busyReason, parseRetryAfter } from '../../../src/infrastructure/nessy/nessy-client'

describe('nessy-client: Retry-After и временные отказы', () => {
	it('секунды и HTTP-дата → мс; мусор → null', () => {
		assert.equal(parseRetryAfter('3'), 3000)
		assert.equal(parseRetryAfter('0'), 0)
		assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4000), 6000)
		assert.equal(parseRetryAfter('скоро'), null)
		assert.equal(parseRetryAfter(undefined), null)
	})
	it('различает причины отказа', () => {
		assert.equal(busyReason(503, 'prompt_queue_full'), 'queue_full')
		assert.equal(busyReason(409, 'session_busy'), 'session_busy')
		assert.equal(busyReason(429, ''), 'rate_limited')
		assert.equal(busyReason(503, ''), 'unavailable')
		assert.equal(busyReason(404, 'no_session'), null)
		assert.equal(busyReason(400, ''), null)
	})
})
