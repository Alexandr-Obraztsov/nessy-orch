/** Модель агента: приоритет запрос → роль → пространство, фактическая модель из подтверждения, подсказка рантайма роли, смена модели. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import type { RuntimeId } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import type { FakeAgentPortOptions } from '../../support/fake-agent-port'
import { FakeAgentPort, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

interface Stand {
	orch: Orchestrator
	gw: FakeAgentPort
	runtimes: Array<{ name: string; runtime: RuntimeId | undefined }>
}

function setup(port: FakeAgentPortOptions = {}, spaceModel?: string): Stand {
	const gw = new FakeAgentPort(port)
	const runtimes: Stand['runtimes'] = []
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs: 3000 },
		store: new MemoryStore(),
		spaceFactory: (init, listener) => {
			runtimes.push({ name: init.name, runtime: init.runtime })
			return new FakeSpace(init.name, init.path, gw, listener, { ...(init.runtime ? { runtime: init.runtime } : {}), model: init.model ?? null })
		},
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main', ...(spaceModel ? { model: spaceModel } : {}) })
	return { orch, gw, runtimes }
}

/** Агент без поручения подключается в фоне: ждём создания его сессии. */
async function spawned(st: Stand, req: { model?: string; role?: string; name?: string } = {}): Promise<string> {
	const before = st.gw.createdModels.length
	const r = await st.orch.spawn({ space: 'main', ...req })
	await until(() => st.gw.createdModels.length > before, 2000, 'сессия создана')
	return r.agent.id
}

const role = (st: Stand, id: string, extra: { model?: string; runtime?: RuntimeId } = {}): void => {
	st.orch.createRole({ id, name: id, instructions: 'делай', ...extra })
}

describe('модель агента: приоритет при запуске', () => {
	it('запрос важнее роли, роль важнее пространства, пространство важнее дефолта рантайма', async () => {
		const st = setup({}, 'space-m')
		role(st, 'r1', { model: 'role-m' })
		role(st, 'r2')
		await spawned(st, { model: 'req-m', role: 'r1', name: 'a1' })
		await spawned(st, { role: 'r1', name: 'a2' })
		await spawned(st, { role: 'r2', name: 'a3' })
		assert.deepEqual(st.gw.createdModels, ['req-m', 'role-m', 'space-m'])
		const bare = setup()
		await spawned(bare)
		assert.deepEqual(bare.gw.createdModels, [null], 'нигде модели нет — дефолт рантайма')
	})

	it('неверный формат модели в запросе — 400, агент не создаётся', async () => {
		const st = setup()
		await assert.rejects(
			() => st.orch.spawn({ space: 'main', model: 'две модели' }),
			(e: unknown) => typeof e === 'object' && e !== null && 'status' in e && e.status === 400,
		)
		assert.equal(st.orch.listAgents().length, 0)
	})
})

describe('модель агента: фактическая и запрошенная', () => {
	it('подтверждённая модель — model, расхождения нет', async () => {
		const st = setup({ reportModel: true })
		const id = await spawned(st, { model: 'm1' })
		await until(() => st.orch.getAgent(id).modelConfirmed === true, 2000, 'модель подтверждена')
		const v = st.orch.getAgent(id)
		assert.equal(v.model, 'm1')
		assert.equal(v.modelRequested, null)
	})

	it('рантайм подставил другую модель: model — фактическая, modelRequested — запрошенная', async () => {
		const st = setup({ reportModel: true, actualModelOf: () => 'fallback' })
		const id = await spawned(st, { model: 'm1' })
		await until(() => st.orch.getAgent(id).modelConfirmed === true, 2000, 'модель подтверждена')
		const v = st.orch.getAgent(id)
		assert.equal(v.model, 'fallback')
		assert.equal(v.modelRequested, 'm1')
	})

	it('до подтверждения model — запрошенная (из пространства), modelConfirmed=false; псевдоним совпадает с полным id', async () => {
		const st = setup({}, 'opus')
		const id = await spawned(st)
		const v = st.orch.getAgent(id)
		assert.equal(v.model, 'opus')
		assert.equal(v.modelConfirmed, false)
		const st2 = setup({ reportModel: true, actualModelOf: m => (m === 'opus' ? 'claude-opus-4-5' : m) })
		const id2 = await spawned(st2, { model: 'opus' })
		await until(() => st2.orch.getAgent(id2).modelConfirmed === true, 2000, 'модель подтверждена')
		assert.equal(st2.orch.getAgent(id2).model, 'claude-opus-4-5')
		assert.equal(st2.orch.getAgent(id2).modelRequested, null, 'opus ≈ claude-opus-*: расхождения нет')
	})

	it('модель переживает рестарт оркестратора (state.json)', async () => {
		const store = new MemoryStore()
		const gw = new FakeAgentPort({ reportModel: true })
		const mk = (): Orchestrator =>
			new Orchestrator({
				settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch' },
				store,
				spaceFactory: (init, listener) => new FakeSpace(init.name, init.path, gw, listener, { model: init.model ?? null }),
			})
		const a = mk()
		a.addSpace({ path: os.tmpdir(), name: 'main' })
		const r = await a.spawn({ space: 'main', model: 'm9' })
		await until(() => a.getAgent(r.agent.id).modelConfirmed === true, 2000, 'модель подтверждена')
		await a.shutdown()
		const b = mk()
		b.load()
		const v = b.getAgent(r.agent.id)
		assert.equal(v.model, 'm9')
		assert.equal(v.modelConfirmed, true)
	})
})

describe('роль: рантайм — подсказка новому пространству', () => {
	it('новое пространство создаётся на рантайме роли; явный runtime запроса важнее; существующее не переключается', async () => {
		const st = setup()
		role(st, 'tc', { runtime: 'tclaude' })
		const dirs = ['a', 'b'].map(n => fs.mkdtempSync(path.join(os.tmpdir(), `nessy-model-${n}-`)))
		const [a, b] = dirs as [string, string]
		try {
			await st.orch.spawn({ space: a, role: 'tc', name: 'x1' })
			assert.equal(st.runtimes.at(-1)?.runtime, 'tclaude', 'подсказка роли')
			await st.orch.spawn({ space: b, role: 'tc', runtime: 'nessy-sdk', name: 'x2' })
			assert.equal(st.runtimes.at(-1)?.runtime, 'nessy-sdk', 'явный запрос важнее роли')
			// «main» уже на nessy-sdk: подсказка роли не вызывает runtime_mismatch и не переключает пространство
			const r = await st.orch.spawn({ space: 'main', role: 'tc', name: 'x3' })
			assert.equal(r.agent.runtime, 'nessy-sdk')
			// явный запрос, не совпавший с существующим пространством, по-прежнему 409
			await assert.rejects(
				() => st.orch.spawn({ space: 'main', runtime: 'tclaude', name: 'x4' }),
				(e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === 'runtime_mismatch',
			)
		} finally {
			for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
		}
	})
})

describe('смена модели у живого агента', () => {
	const code = (e: unknown): string => (typeof e === 'object' && e !== null && 'status' in e && 'code' in e ? `${String(e.status)}:${String(e.code)}` : String(e))

	it('успех: порт получил модель, AgentView.model — новая', async () => {
		const st = setup({ reportModel: true })
		const id = await spawned(st, { model: 'm1' })
		await until(() => st.orch.getAgent(id).modelConfirmed === true, 2000, 'подтверждена')
		const v = await st.orch.setAgentModel(id, { model: 'm2' })
		assert.deepEqual(st.gw.modelSets, ['m2'])
		await until(() => st.orch.getAgent(id).model === 'm2', 2000, 'модель сменилась')
		assert.equal(v.id, id)
		assert.equal(st.orch.getAgent(id).modelRequested, null)
	})

	it('рантайм выбрал другую модель: model — фактическая, modelRequested — запрошенная', async () => {
		const st = setup({ reportModel: true, actualModelOf: m => (m === 'm2' ? 'zzz' : m) })
		const id = await spawned(st, { model: 'm1' })
		await until(() => st.orch.getAgent(id).modelConfirmed === true, 2000, 'подтверждена')
		await st.orch.setAgentModel(id, { model: 'm2' })
		await until(() => st.orch.getAgent(id).model === 'zzz', 2000, 'фактическая модель')
		assert.equal(st.orch.getAgent(id).modelRequested, 'm2')
	})

	it('рантайм без setModel — 409 model_switch_unsupported', async () => {
		const st = setup({ capabilities: { setModel: false } })
		const id = await spawned(st)
		await assert.rejects(() => st.orch.setAgentModel(id, { model: 'm2' }), (e: unknown) => code(e) === '409:model_switch_unsupported')
		assert.deepEqual(st.gw.modelSets, [])
	})

	it('работающий агент — 409 busy; пустая модель — 400; неизвестный агент — 404', async () => {
		const st = setup()
		const r = await st.orch.spawn({ space: 'main', prompt: '#slow' })
		await until(() => st.orch.getAgent(r.agent.id).status === 'working', 2000, 'работает')
		await assert.rejects(() => st.orch.setAgentModel(r.agent.id, { model: 'm2' }), (e: unknown) => code(e) === '409:busy')
		await assert.rejects(() => st.orch.setAgentModel(r.agent.id, { model: '  ' }), (e: unknown) => code(e) === '400:bad_request')
		await assert.rejects(() => st.orch.setAgentModel('nope', { model: 'm2' }), (e: unknown) => code(e).startsWith('404:'))
		await st.orch.cancelAgent(r.agent.id)
	})
})
