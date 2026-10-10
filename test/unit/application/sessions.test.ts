/** Сервис сессий на хранилище в памяти: CRUD, события шины, привязка агентов, раздельные курсоры inbox. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, SessionView } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { AppError } from '../../../src/domain/errors'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'

interface Ctx {
	orch: Orchestrator
	store: MemoryStore
	hub: HubEvent[]
}

function setup(store = new MemoryStore()): Ctx {
	const gw = new FakeGateway()
	let n = 0
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch' },
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
		// предсказуемые суффиксы: 0000, 0000 (коллизия), 0001, …
		sessionSuffix: () => String(Math.max(0, n++ - 1)).padStart(4, '0'),
	})
	orch.load()
	if (!orch.graph().spaces.length) orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const hub: HubEvent[] = []
	orch.hub.subscribe(e => hub.push(e))
	return { orch, store, hub }
}

const code = (fn: () => unknown): string => {
	try {
		fn()
	} catch (e) {
		return e instanceof AppError ? `${e.status} ${e.code}` : 'other'
	}
	return 'ok'
}

describe('сессии: сервис', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('create: slug + суффикс, коллизия суффикса перебирается, явный id занят → 409', () => {
		const a = ctx.orch.createSession({ title: 'Починить CI', owner: 'claude' })
		assert.equal(a.id, 'pochinit-ci-0000')
		assert.equal(a.status, 'active')
		assert.equal(a.owner, 'claude')
		assert.equal(a.summary, null)
		const b = ctx.orch.createSession({ title: 'Починить CI' })
		assert.equal(b.id, 'pochinit-ci-0001', 'повторный суффикс 0000 пропущен')
		assert.equal(ctx.orch.createSession({ title: 'x', id: 'mine' }).id, 'mine')
		assert.equal(code(() => ctx.orch.createSession({ title: 'y', id: 'mine' })), '409 session_exists')
		assert.deepEqual(ctx.store.sessions.map(t => t.id).sort(), ['mine', 'pochinit-ci-0000', 'pochinit-ci-0001'])
		assert.equal(ctx.hub.filter(e => e.t === 'session').length, 3)
	})

	it('update: done с итогом, reopen, неизвестная → 404', () => {
		const t = ctx.orch.createSession({ title: 'Отчёт' })
		const done = ctx.orch.updateSession(t.id, { status: 'done', summary: '**готово**' })
		assert.equal(done.status, 'done')
		assert.equal(done.summary, '**готово**')
		assert.equal(ctx.orch.listSessions('active').length, 0)
		assert.equal(ctx.orch.listSessions('done')[0]?.id, t.id)
		const again = ctx.orch.updateSession(t.id, { status: 'active' })
		assert.equal(again.summary, '**готово**', 'итог сохраняется, пока его не сбросят')
		assert.equal(code(() => ctx.orch.updateSession('nope', { title: 'x' })), '404 no_session')
		const last = ctx.hub.filter((e): e is Extract<HubEvent, { t: 'session' }> => e.t === 'session').at(-1)
		assert.equal(last?.session.status, 'active')
	})

	it('spawn: сессия проверяется (no_session), агент агента наследует сессию родителя', async () => {
		const t = ctx.orch.createSession({ title: 'Ящик' })
		await assert.rejects(ctx.orch.spawn({ space: 'main', session: 'nope' }), (e: unknown) => e instanceof AppError && e.code === 'no_session')
		const parent = (await ctx.orch.spawn({ space: 'main', name: 'lead', session: t.id })).agent
		assert.equal(parent.session, t.id)
		const child = (await ctx.orch.spawn({ space: 'main', name: 'helper', from: parent.id })).agent
		assert.equal(child.session, t.id, 'наследуется от родителя')
		const loose = (await ctx.orch.spawn({ space: 'main', name: 'loose' })).agent
		assert.equal(loose.session, null)
		assert.deepEqual(ctx.orch.listAgents(t.id).map(a => a.name).sort(), ['helper', 'lead'])
		assert.equal(ctx.orch.graph().sessions.length, 1)
		assert.equal(ctx.orch.snapshot().sessions[0]?.id, t.id)
	})

	it('remove: занятый агент → 409 session_busy; иначе агенты отвязываются (session=null)', async () => {
		const t = ctx.orch.createSession({ title: 'Удаляемая' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'w', session: t.id })).agent
		const agent = ctx.orch.resolveAgent(a.id)
		agent.queue.push({ seq: 0, id: 'm-x', ts: 0, from: 'you', to: a.id, kind: 'msg', text: 'ждёт', hops: 0 })
		assert.equal(code(() => ctx.orch.removeSession(t.id)), '409 session_busy')
		agent.queue.length = 0
		ctx.orch.removeSession(t.id)
		assert.equal(ctx.orch.getAgent(a.id).session, null)
		assert.equal(code(() => ctx.orch.getSession(t.id)), '404 no_session')
		assert.ok(ctx.hub.some(e => e.t === 'session_removed' && e.id === t.id))
		assert.ok(ctx.hub.some(e => e.t === 'agent' && e.agent.id === a.id && e.agent.session === null))
	})

	it('inbox по сессии: свои ответы и свой курсор; общий inbox не трогается', async () => {
		const t1 = ctx.orch.createSession({ title: 'Первая' })
		const t2 = ctx.orch.createSession({ title: 'Вторая' })
		const a1 = (await ctx.orch.spawn({ space: 'main', name: 'a1', session: t1.id })).agent.id
		const a2 = (await ctx.orch.spawn({ space: 'main', name: 'a2', session: t2.id })).agent.id
		ctx.orch.post({ from: a1, to: 'you', kind: 'reply', text: 'от a1' })
		ctx.orch.post({ from: a2, to: 'you', kind: 'reply', text: 'от a2' })
		const r1 = await ctx.orch.inbox({ session: t1.id })
		assert.deepEqual(r1.messages.map(m => m.text), ['от a1'])
		assert.deepEqual((await ctx.orch.inbox({ session: t1.id })).messages, [], 'курсор сессии сдвинут')
		assert.deepEqual((await ctx.orch.inbox({ session: t2.id, peek: true })).messages.map(m => m.text), ['от a2'])
		assert.deepEqual((await ctx.orch.inbox({ session: t2.id })).messages.map(m => m.text), ['от a2'], 'peek не сдвинул')
		assert.deepEqual((await ctx.orch.inbox()).messages.map(m => m.text), ['от a1', 'от a2'], 'общий курсор отдельно')
		await assert.rejects(ctx.orch.inbox({ session: 'nope' }), (e: unknown) => e instanceof AppError && e.code === 'no_session')
	})

	it('long-poll сессии не просыпается от ответа чужой сессии', async () => {
		const t1 = ctx.orch.createSession({ title: 'Первая' })
		const t2 = ctx.orch.createSession({ title: 'Вторая' })
		const a1 = (await ctx.orch.spawn({ space: 'main', name: 'a1', session: t1.id })).agent.id
		const a2 = (await ctx.orch.spawn({ space: 'main', name: 'a2', session: t2.id })).agent.id
		const waiting = ctx.orch.inbox({ session: t1.id, wait: 5 })
		setTimeout(() => ctx.orch.post({ from: a2, to: 'you', kind: 'reply', text: 'чужое' }), 20)
		setTimeout(() => ctx.orch.post({ from: a1, to: 'you', kind: 'reply', text: 'своё' }), 80)
		assert.deepEqual((await waiting).messages.map(m => m.text), ['своё'])
	})

	it('рестарт: сессии, привязка агентов и курсоры сессий восстанавливаются; старые агенты → session=null', async () => {
		const t = ctx.orch.createSession({ title: 'Живучая' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'keeper', session: t.id })).agent.id
		ctx.orch.post({ from: a, to: 'you', kind: 'reply', text: 'раз' })
		await ctx.orch.inbox({ session: t.id })
		await ctx.orch.shutdown()
		// агент из старой версии состояния — без поля session
		const legacy = { ...(ctx.store.state.agents[0] as (typeof ctx.store.state.agents)[number]), id: 'a-old', name: 'old' }
		delete legacy.session
		ctx.store.state.agents.push(legacy)
		const next = setup(ctx.store)
		assert.deepEqual(next.orch.listSessions().map((x: SessionView) => x.id), [t.id])
		assert.equal(next.orch.getAgent('keeper').session, t.id)
		assert.equal(next.orch.getAgent('old').session, null)
		assert.deepEqual((await next.orch.inbox({ session: t.id })).messages, [], 'курсор сессии сохранён')
		await next.orch.shutdown()
	})
})
