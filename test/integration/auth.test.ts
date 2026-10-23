/** Доступ: токен оператора и ключи агентов (проверка включена, как в продакшене). */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { AgentView, ApiError, SendResponse, SessionView, SpawnResponse } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 25000 }
const TOKEN = 'operator-token-0123456789abcdef0123456789'
const CLI = path.resolve(__dirname, '..', '..', '..', 'bin', 'nessy-orch')
const op = { 'X-Orch-Token': TOKEN }

describe('доступ: токен оператора и ключи агентов', () => {
	let h: Harness
	let a: string
	let b: string
	const key = (id: string): string => h.orch.resolveAgent(id).key
	const cli = (env: Record<string, string>, ...args: string[]): Promise<{ code: number; out: string }> =>
		new Promise(resolve => {
			execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ORCH_PORT: String(h.port), NO_COLOR: '1', ...env } }, (err, stdout, stderr) =>
				resolve({ code: err ? 1 : 0, out: stdout + stderr }),
			)
		})

	before(async () => {
		h = await startHarness({ config: { authToken: TOKEN, authRequired: true } })
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' }, op)
		a = (await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'alpha' }, op)).body.agent.id
		b = (await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'beta' }, op)).body.agent.id
	})
	after(() => h.close())

	it('чтение открыто без токена, изменения — только с токеном оператора', T, async () => {
		assert.equal((await h.api('GET', '/graph')).status, 200)
		const denied = await h.api<ApiError>('POST', '/sessions', { title: 'без токена' })
		assert.equal(denied.status, 403)
		assert.equal(denied.body.code, 'operator_required')
		assert.equal((await h.api<SessionView>('POST', '/sessions', { title: 'с токеном' }, op)).status, 201)
		assert.equal((await h.api('POST', `/agents/${a}/cancel`, {})).status, 403)
		assert.equal((await h.api('DELETE', `/agents/${b}`, undefined)).status, 403)
		assert.equal((await h.api('POST', '/sessions', { title: 'x' })).status, 403)
		assert.equal((await h.api('POST', '/sessions/nope/closed', {})).status, 403)
	})

	it('ключ агента не попадает ни в граф, ни в список, ни в историю', T, async () => {
		const k = key(a)
		assert.ok(k.length >= 20)
		const dump = JSON.stringify([(await h.api('GET', '/graph')).body, (await h.api('GET', '/agents')).body, (await h.api('GET', `/agents/${a}`)).body])
		assert.ok(!dump.includes(k), 'ключ виден через API')
	})

	it('агент пишет от своего имени по ключу; чужое имя, без ключа и от имени оператора — 403', T, async () => {
		const ok = await h.api<SendResponse>('POST', `/agents/${b}/send`, { from: a, text: 'привет' }, { 'X-Agent-Key': key(a) })
		assert.equal(ok.status, 200)
		const wrongKey = await h.api<ApiError>('POST', `/agents/${b}/send`, { from: a, text: 'x' }, { 'X-Agent-Key': 'nope' })
		assert.equal(wrongKey.body.code, 'bad_agent_key')
		const otherKey = await h.api<ApiError>('POST', `/agents/${b}/send`, { from: a, text: 'x' }, { 'X-Agent-Key': key(b) })
		assert.equal(otherKey.status, 403, 'ключ другого агента не подходит')
		const asYou = await h.api<ApiError>('POST', `/agents/${b}/send`, { from: 'you', text: 'x' }, { 'X-Agent-Key': key(a) })
		assert.equal(asYou.body.code, 'operator_required')
		const noFrom = await h.api<ApiError>('POST', `/agents/${b}/send`, { text: 'x' })
		assert.equal(noFrom.body.code, 'operator_required')
		const asUser = await h.api<ApiError>('POST', `/agents/${b}/send`, { from: 'user', text: 'x' }, { 'X-Agent-Key': key(a) })
		assert.equal(asUser.status, 403)
	})

	it('агент запускает агентов и ведёт план только от своего имени; родителя не подменить', T, async () => {
		const spawned = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'child', from: a, parent: b }, { 'X-Agent-Key': key(a) })
		assert.equal(spawned.status, 201)
		assert.equal(h.orch.getAgent('child').parent, a, 'parent задаёт сервер: это вызвавший агент')
		assert.equal((await h.api('POST', '/agents', { space: 'main', name: 'sneaky' })).status, 403)
		const plan = await h.api<AgentView>(
			'POST',
			`/agents/${a}/plan`,
			{ from: a, entries: [{ content: 'шаг', status: 'in_progress' }] },
			{ 'X-Agent-Key': key(a) },
		)
		assert.equal(plan.status, 200)
		assert.equal((await h.api('POST', `/agents/${a}/plan`, { from: b, entries: [] }, { 'X-Agent-Key': key(b) })).status, 403, 'чужой план — только сам агент')
	})

	it('CLI: токен оператора берётся из NESSY_ORCH_TOKEN, ключ агента — из --key', T, async () => {
		const denied = await cli({}, 'session', 'new', 'через cli без токена')
		assert.notEqual(denied.code, 0)
		assert.match(denied.out, /operator_required/)
		const allowed = await cli({ NESSY_ORCH_TOKEN: TOKEN }, 'session', 'new', 'через cli с токеном')
		assert.equal(allowed.code, 0, allowed.out)
		const agent = await cli({}, 'send', '--from', a, '--key', key(a), b, 'из cli')
		assert.equal(agent.code, 0, agent.out)
		const bad = await cli({}, 'send', '--from', a, '--key', 'nope', b, 'из cli')
		assert.match(bad.out, /bad_agent_key/)
	})
})
