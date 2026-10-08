/** nessy serve с NESSY_SERVER_TOKEN: оркестратор передаёт `Authorization: Bearer` (health, сессии, события). */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { SpawnResponse } from '../../shared/types'
import { NessyClient } from '../../src/infrastructure/nessy/nessy-client'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const TOKEN = 'test-secret'

describe('токен nessy serve', () => {
	let h: Harness
	let prev: string | undefined
	before(async () => {
		// дочерний serve наследует окружение оркестратора — как у пользователя
		prev = process.env['NESSY_SERVER_TOKEN']
		process.env['NESSY_SERVER_TOKEN'] = TOKEN
		h = await startHarness({ config: { nessyToken: TOKEN } })
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
	})
	after(async () => {
		await h.close()
		if (prev === undefined) delete process.env['NESSY_SERVER_TOKEN']
		else process.env['NESSY_SERVER_TOKEN'] = prev
	})

	it('агент с токеном создаётся и отвечает', { timeout: 25000 }, async () => {
		const r = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'tok', prompt: 'привет', wait: true })
		assert.equal(r.status, 201)
		assert.equal(r.body.reply?.text, 'ответ: привет')
	})

	it('без токена serve отвечает 401 — health не проходит', { timeout: 10000 }, async () => {
		const url = h.orch.getSpace('main')?.toJSON().url
		assert.ok(url, 'serve запущен')
		const anon = new NessyClient(url)
		assert.equal(await anon.health(), false)
		assert.equal(await new NessyClient(url, TOKEN).health(), true)
	})
})
