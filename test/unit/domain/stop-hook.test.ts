import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DigestResponse } from '../../../shared/types'
import { stopDecision, waitCommand } from '../../../src/domain/stop-hook'

const digest = (over: Partial<DigestResponse> = {}): DigestResponse => ({ header: 'Ответы:', text: '', cursor: 0, count: 0, hidden: 0, working: [], watching: false, ...over })

describe('хук Stop: решение', () => {
	it('нечего сообщить и никто не работает — остановиться', () => {
		assert.deepEqual(stopDecision(digest(), 's1', false), { reason: null, ackCursor: 0 })
	})
	it('пришли ответы — вернуть в работу со сводкой и подтвердить курсор; ожидание не просят, если уже идёт', () => {
		const d = stopDecision(digest({ count: 2, text: '[ci]\nготово', cursor: 7, working: ['mr'], watching: true }), 's1', true)
		assert.match(d.reason ?? '', /Ответы:\n\n\[ci\]\nготово$/)
		assert.equal(d.ackCursor, 7)
	})
	it('ответы пришли, а ожидания нет — в той же причине просьба запустить его', () => {
		const d = stopDecision(digest({ count: 1, text: 'x', cursor: 3, working: ['mr'] }), 's1', true)
		assert.match(d.reason ?? '', new RegExp(waitCommand('s1').replace(/[-]/g, '\\$&')))
	})
	it('агенты работают, ожидания нет — просим один раз (при stop_hook_active не повторяем)', () => {
		assert.match(stopDecision(digest({ working: ['a', 'b'] }), 's1', false).reason ?? '', /Агенты ещё работают: a, b/)
		assert.equal(stopDecision(digest({ working: ['a'] }), 's1', true).reason, null)
	})
	it('ожидание уже висит — не просим', () => {
		assert.equal(stopDecision(digest({ working: ['a'], watching: true }), 's1', false).reason, null)
	})
})
