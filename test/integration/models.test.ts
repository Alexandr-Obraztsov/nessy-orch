/** Модели через HTTP: роль с model/runtime, GET /runtimes, модель при spawn, POST /agents/:ref/model. */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AgentView, ApiError, RoleView, RuntimeInfo, SpawnResponse } from '../../shared/types'
import { FakeAgentPort } from '../support/fake-agent-port'
import { startHarness } from '../support/harness'
import { FakeSpace } from '../support/memory-store'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 25000 }

describe('модели: HTTP', () => {
	let h: Harness
	let port: FakeAgentPort
	before(async () => {
		port = new FakeAgentPort({ reportModel: true, actualModelOf: m => (m === 'lies' ? 'actual-other' : m) })
		h = await startHarness({
			config: { sdkModel: 'sdk-default' },
			spaceFactory: (init, listener) => new FakeSpace(init.name, init.path, port, listener, { model: init.model ?? null }),
		})
	})
	after(() => h.close())

	it('GET /runtimes: оба рантайма, capabilities, дефолт из конфигурации, подтверждённые псевдонимы', T, async () => {
		const r = await h.api<RuntimeInfo[]>('GET', '/runtimes')
		assert.equal(r.status, 200)
		assert.deepEqual(
			r.body.map(x => x.id),
			['nessy-sdk', 'tclaude'],
		)
		const sdk = r.body.find(x => x.id === 'nessy-sdk')
		const tc = r.body.find(x => x.id === 'tclaude')
		assert.ok(sdk && tc)
		assert.equal(sdk.defaultModel, 'sdk-default')
		assert.deepEqual(sdk.models, [{ id: 'sdk-default', label: 'sdk-default' }], 'у nessy-sdk только дефолт конфигурации: перечислить модели SDK нечем')
		assert.deepEqual(sdk.capabilities, { setModel: true, midTurn: false, permissionVote: true, streamText: true })
		assert.equal(sdk.available, true)
		assert.equal(tc.defaultModel, null)
		assert.deepEqual(
			tc.models.map(m => m.id),
			['opus', 'sonnet', 'haiku'],
		)
		assert.deepEqual(tc.capabilities, { setModel: true, midTurn: true, permissionVote: false, streamText: true })
		assert.equal(typeof tc.available, 'boolean')
	})

	it('роль: model/runtime создаются, правка без значения сохраняет, пустая строка и null убирают, мусор — 400', T, async () => {
		const c = await h.api<RoleView>('POST', '/roles', { name: 'Быстрый', id: 'fast', instructions: 'x', model: 'haiku', runtime: 'tclaude' })
		assert.equal(c.status, 201, JSON.stringify(c.body))
		assert.equal(c.body.model, 'haiku')
		assert.equal(c.body.runtime, 'tclaude')
		const keep = await h.api<RoleView>('PUT', '/roles/fast', { name: 'Быстрый', instructions: 'y' })
		assert.equal(keep.body.model, 'haiku')
		assert.equal(keep.body.runtime, 'tclaude')
		const change = await h.api<RoleView>('PUT', '/roles/fast', { name: 'Быстрый', instructions: 'y', model: 'sonnet' })
		assert.equal(change.body.model, 'sonnet')
		const clear = await h.api<RoleView>('PUT', '/roles/fast', { name: 'Быстрый', instructions: 'y', model: '', runtime: null })
		assert.equal(clear.body.model, null)
		assert.equal(clear.body.runtime, null)
		const badModel = await h.api<ApiError>('POST', '/roles', { name: 'B1', instructions: 'x', model: 'две модели' })
		assert.equal(badModel.status, 400)
		const badRuntime = await h.api<ApiError>('POST', '/roles', { name: 'B2', instructions: 'x', runtime: 'bogus' })
		assert.equal(badRuntime.status, 400)
		assert.equal(badRuntime.body.code, 'bad_request')
	})

	it('spawn: модель из роли, запрос её перебивает; фактическая модель видна в AgentView и в /runtimes', T, async () => {
		await h.api('POST', '/roles', { name: 'Думающий', id: 'thinker', instructions: 'x', model: 'role-model' })
		const fromRole = await h.api<SpawnResponse>('POST', '/agents', { space: h.ws, role: 'thinker', name: 'by-role' })
		assert.equal(fromRole.status, 201, JSON.stringify(fromRole.body))
		const byRequest = await h.api<SpawnResponse>('POST', '/agents', { space: h.ws, role: 'thinker', model: 'req-model', name: 'by-req' })
		await until(() => port.createdModels.length >= 2, 4000, 'сессии созданы')
		assert.deepEqual(port.createdModels.slice(-2), ['role-model', 'req-model'])
		await until(() => h.orch.getAgent(byRequest.body.agent.id).modelConfirmed === true, 4000, 'модель подтверждена')
		assert.equal(h.orch.getAgent(byRequest.body.agent.id).model, 'req-model')
		const rts = await h.api<RuntimeInfo[]>('GET', '/runtimes')
		const sdkModels = rts.body.find(x => x.id === 'nessy-sdk')?.models.map(m => m.id) ?? []
		assert.ok(sdkModels.includes('req-model'), `модель встреченного агента попадает в каталог: ${sdkModels.join(',')}`)
	})

	it('POST /agents/:ref/model: смена, расхождение фактической модели, 400 и 404', T, async () => {
		const sp = await h.api<SpawnResponse>('POST', '/agents', { space: h.ws, model: 'm1', name: 'switch-me' })
		const id = sp.body.agent.id
		await until(() => h.orch.getAgent(id).modelConfirmed === true, 4000, 'модель подтверждена')
		const ok = await h.api<AgentView>('POST', `/agents/${id}/model`, { model: 'm2' })
		assert.equal(ok.status, 200, JSON.stringify(ok.body))
		await until(() => h.orch.getAgent(id).model === 'm2', 4000, 'model.switched')
		assert.equal(h.orch.getAgent(id).modelRequested, null)
		const lie = await h.api<AgentView>('POST', `/agents/${id}/model`, { model: 'lies' })
		assert.equal(lie.status, 200)
		await until(() => h.orch.getAgent(id).model === 'actual-other', 4000, 'model.switch_failed')
		assert.equal(h.orch.getAgent(id).modelRequested, 'lies')
		const empty = await h.api<ApiError>('POST', `/agents/${id}/model`, { model: '' })
		assert.equal(empty.status, 400)
		const none = await h.api<ApiError>('POST', '/agents/nope/model', { model: 'm2' })
		assert.equal(none.status, 404)
	})
})
