/** Роли: CRUD, проверки, хранение в roles.json, события /stream, spawn с ролью. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import type { ApiError, RoleView, SpawnResponse, StatusResponse, StreamEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 25000 }
const isStream = (e: unknown): e is StreamEvent => typeof e === 'object' && e !== null && 't' in e

describe('роли', () => {
	let h: Harness | null = null
	let restarted: Harness | null = null
	after(async () => {
		await h?.close({ keepFiles: true })
		await restarted?.close()
	})
	const api = (): Harness => {
		assert.ok(h)
		return h
	}

	it('создание: id из имени (транслит), цвет из имени, события в /stream', T, async () => {
		h = await startHarness()
		const s = await h.sse('/stream')
		try {
			await s.waitFor((e): e is StreamEvent => isStream(e) && e.t === 'snapshot')
			const r = await h.api<RoleView>('POST', '/roles', { name: 'Ревьюер кода', description: 'смотрит MR', instructions: 'Проверяй MR строго.' })
			assert.equal(r.status, 201)
			assert.equal(r.body.id, 'revyuer-koda')
			assert.equal(r.body.name, 'Ревьюер кода')
			assert.ok(r.body.color >= 0 && r.body.color < 360)
			assert.equal(r.body.createdAt, r.body.updatedAt)
			const ev = await s.waitFor((e): e is Extract<StreamEvent, { t: 'role' }> => isStream(e) && e.t === 'role', 4000, 'role в /stream')
			assert.equal(ev.role.id, 'revyuer-koda')

			const custom = await h.api<RoleView>('POST', '/roles', { name: 'Reviewer', id: 'reviewer', instructions: 'Смотри MR.', color: 120 })
			assert.equal(custom.status, 201)
			assert.equal(custom.body.color, 120)

			assert.equal((await h.api<ApiError>('DELETE', '/roles/revyuer-koda')).status, 200)
			await s.waitFor((e): e is StreamEvent => isStream(e) && e.t === 'role_removed' && e.id === 'revyuer-koda', 4000, 'role_removed')
		} finally {
			s.close()
		}
	})

	it('проверки: 400 bad_request, 409 role_exists, 404 no_role', T, async () => {
		const h = api()
		const code = async (method: string, p: string, body?: unknown): Promise<string> => {
			const r = await h.api<ApiError>(method, p, body)
			return `${r.status}:${r.body.code}`
		}
		assert.equal(await code('POST', '/roles', { name: 'x' }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: '  ', instructions: 'i' }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: 'x'.repeat(61), instructions: 'i' }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: 'x', instructions: 'i'.repeat(20001) }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: 'x', instructions: 'i', id: 'Bad Id' }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: 'x', instructions: 'i', id: 'a'.repeat(41) }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: 'x', instructions: 'i', color: 400 }), '400:bad_request')
		assert.equal(await code('POST', '/roles', { name: 'Другая', id: 'reviewer', instructions: 'i' }), '409:role_exists')
		assert.equal(await code('POST', '/roles', { name: 'REVIEWER', instructions: 'i' }), '409:role_exists')
		assert.equal(await code('GET', '/roles/nope'), '404:no_role')
		assert.equal(await code('PUT', '/roles/nope', { name: 'n', instructions: 'i' }), '404:no_role')
		assert.equal(await code('DELETE', '/roles/nope'), '404:no_role')
	})

	it('чтение и изменение: GET по id и имени, PUT сохраняет id/createdAt/цвет', T, async () => {
		const h = api()
		assert.equal((await h.api<RoleView>('GET', '/roles/reviewer')).body.name, 'Reviewer')
		assert.equal((await h.api<RoleView>('GET', `/roles/${encodeURIComponent('REVIEWER')}`)).body.id, 'reviewer')
		const before = (await h.api<RoleView>('GET', '/roles/reviewer')).body
		await new Promise(r => setTimeout(r, 5))
		const put = await h.api<RoleView>('PUT', '/roles/reviewer', { name: 'Reviewer', description: 'MR', instructions: 'Смотри MR внимательно. Пиши кратко.' })
		assert.equal(put.status, 200)
		assert.equal(put.body.id, 'reviewer')
		assert.equal(put.body.createdAt, before.createdAt)
		assert.notEqual(put.body.updatedAt, before.updatedAt)
		assert.equal(put.body.color, 120)
		assert.equal(put.body.description, 'MR')
		const list = await h.api<RoleView[]>('GET', '/roles')
		assert.deepEqual(
			list.body.map(r => r.id),
			['reviewer'],
		)
		assert.equal((await h.api<StatusResponse>('GET', '/status')).body.roles, 1)
		assert.equal(h.orch.graph().roles.length, 1)
	})

	it('spawn с ролью: роль по имени, имя по умолчанию reviewer/reviewer-2, инструкции во вводной', T, async () => {
		const h = api()
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
		const first = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', role: 'Reviewer', prompt: 'глянь MR', wait: true })
		assert.equal(first.status, 201)
		assert.equal(first.body.agent.name, 'reviewer')
		assert.equal(first.body.agent.role, 'reviewer')
		const second = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', role: 'reviewer' })
		assert.equal(second.body.agent.name, 'reviewer-2')
		const named = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', role: 'reviewer', name: 'strict' })
		assert.equal(named.body.agent.name, 'strict')
		const unknown = await h.api<ApiError>('POST', '/agents', { space: 'main', role: 'nope' })
		assert.equal(unknown.status, 404)
		assert.equal(unknown.body.code, 'no_role')

		const prompt = h.orch.agentHistory('reviewer').find(e => e.kind === 'user')
		assert.ok(prompt)
		const preamble = h.orch.resolveAgent('reviewer')
		assert.equal(preamble.introduced, true)
		// во вводную попадают инструкции роли (проверяем текст, который ушёл бы в новый контекст)
		const text = h.orch.preambleFor(preamble)
		assert.match(text, /Твоя роль: Reviewer\nСмотри MR внимательно\. Пиши кратко\.$/)
		assert.match(h.orch.preambleFor(h.orch.resolveAgent('reviewer-2')), /reviewer \(a-\w+, main, роль Reviewer\) — в архиве/)
	})

	it('роли переживают рестарт (roles.json); агенты сохраняют id удалённой роли', T, async () => {
		const prev = api()
		const file = path.join(prev.home, 'roles.json')
		assert.ok(fs.existsSync(file))
		assert.equal((await prev.api('DELETE', '/roles/reviewer')).status, 200)
		assert.equal(prev.orch.getAgent('reviewer').role, 'reviewer', 'id роли у агента остаётся')
		assert.doesNotMatch(prev.orch.preambleFor(prev.orch.resolveAgent('reviewer')), /Твоя роль/)
		await prev.api('POST', '/roles', { name: 'Аналитик', instructions: 'Считай метрики.' })
		const base = prev.base
		await prev.close({ keepFiles: true })
		h = null
		restarted = await startHarness({ base })
		const r = restarted
		assert.deepEqual(
			r.orch.listRoles().map(x => [x.id, x.name, x.instructions]),
			[['analitik', 'Аналитик', 'Считай метрики.']],
		)
		await until(() => r.orch.getAgent('reviewer').role === 'reviewer', 1000, 'роль агента сохранена')
	})
})
