/** Сводка для главного агента по HTTP: сессия вкладки (cwd, chatId), digest, ack, unread, Stop-отчёт, закрытие. */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { ApiError, DigestResponse, SessionView } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 30000 }
const CHAT = '11111111-2222-3333-4444-555555555555'

describe('digest (HTTP)', () => {
	let h: Harness
	let s: SessionView

	before(async () => {
		h = await startHarness()
		assert.equal((await h.api('POST', '/spaces', { path: h.ws, name: 'main' })).status, 201)
	})
	after(() => h.close())

	it('POST /sessions {cwd, chatId}: заголовок из имени каталога; чат занят — 409; плохие поля — 400', T, async () => {
		const r = await h.api<SessionView>('POST', '/sessions', { cwd: '/Users/me/proj-x/', chatId: CHAT })
		assert.equal(r.status, 201)
		s = r.body
		assert.equal(s.title, 'proj-x')
		assert.equal(s.cwd, '/Users/me/proj-x/')
		assert.equal(s.chatId, CHAT)
		assert.equal(s.unread, 0)
		const dup = await h.api<ApiError>('POST', '/sessions', { cwd: '/tmp/y', chatId: CHAT })
		assert.equal(dup.status, 409)
		assert.equal(dup.body.code, 'chat_bound')
		assert.equal((await h.api<ApiError>('POST', '/sessions', { cwd: 'relative' })).status, 400)
		assert.equal((await h.api<ApiError>('POST', '/sessions', { cwd: '/tmp/z', chatId: 'bad id!' })).status, 400)
	})

	it('digest: ответ агента → unread=1; digest не двигает курсор; ack сдвигает; повторный ack безопасен', T, async () => {
		const sp = await h.api('POST', '/agents', { space: 'main', name: 'ci', session: s.id })
		assert.equal(sp.status, 201)
		assert.equal((await h.api('POST', '/agents/ci/send', { text: 'проверь CI' })).status, 200)
		for (let i = 0; i < 200 && (await h.api<SessionView>('GET', `/sessions/${s.id}`)).body.unread !== 1; i++) await new Promise(r => setTimeout(r, 20))
		assert.equal((await h.api<SessionView>('GET', `/sessions/${s.id}`)).body.unread, 1)
		const d1 = (await h.api<DigestResponse>('GET', `/sessions/${s.id}/digest`)).body
		assert.equal(d1.count, 1)
		assert.match(d1.text, /^\[ci · проверь CI\]\nответ: проверь CI/)
		assert.ok(d1.cursor > 0)
		const d2 = (await h.api<DigestResponse>('GET', `/sessions/${s.id}/digest`)).body
		assert.equal(d2.cursor, d1.cursor, 'без ack сводка приходит снова')
		assert.equal((await h.api('POST', `/sessions/${s.id}/ack`, { cursor: d1.cursor })).status, 200)
		assert.equal((await h.api('POST', `/sessions/${s.id}/ack`, { cursor: d1.cursor })).status, 200)
		const d3 = (await h.api<DigestResponse>('GET', `/sessions/${s.id}/digest`)).body
		assert.deepEqual([d3.text, d3.count], ['', 0])
		assert.equal((await h.api<SessionView>('GET', `/sessions/${s.id}`)).body.unread, 0)
		assert.equal((await h.api<ApiError>('GET', '/sessions/nope/digest')).body.code, 'no_session')
	})

	it('ответ на вызов с --wait в сводку не попадает (он вернулся прямо в вызов)', T, async () => {
		const r = await h.api<{ reply?: { text: string } }>('POST', '/agents/ci/send', { text: 'ещё', wait: true })
		assert.equal(r.body.reply?.text, 'ответ: ещё')
		const d = (await h.api<DigestResponse>('GET', `/sessions/${s.id}/digest`)).body
		assert.equal(d.count, 0)
	})

	it('POST /sessions/:id/lead: chatId обновляется (после /clear); чужой чат — 409; idle отражается в lead', T, async () => {
		const next = '99999999-2222-3333-4444-555555555555'
		const r = await h.api<SessionView>('POST', `/sessions/${s.id}/lead`, { idle: true, chatId: next })
		assert.equal(r.status, 200)
		assert.equal(r.body.chatId, next)
		assert.equal(r.body.lead?.state, 'idle')
		const other = (await h.api<SessionView>('POST', '/sessions', { cwd: '/tmp/other', chatId: CHAT })).body
		const clash = await h.api<ApiError>('POST', `/sessions/${other.id}/lead`, { idle: true, chatId: next })
		assert.equal(clash.status, 409)
		assert.equal((await h.api<ApiError>('POST', `/sessions/${s.id}/lead`, { idle: 'yes' })).status, 400)
	})

	it('POST /sessions/:id/closed: сессия остаётся, lead = ended', T, async () => {
		const r = await h.api<{ cancelled: number }>('POST', `/sessions/${s.id}/closed`)
		assert.equal(r.status, 200)
		assert.equal(r.body.cancelled, 0)
		const v = (await h.api<SessionView>('GET', `/sessions/${s.id}`)).body
		assert.equal(v.lead?.state, 'ended')
		assert.equal(v.status, 'active')
	})
})
