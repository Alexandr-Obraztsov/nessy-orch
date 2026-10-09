/** Сервис задач на хранилище в памяти: CRUD, события шины, привязка агентов, раздельные курсоры inbox. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, TaskView } from '../../../shared/types'
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
		taskSuffix: () => String(Math.max(0, n++ - 1)).padStart(4, '0'),
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

describe('задачи: сервис', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('create: slug + суффикс, коллизия суффикса перебирается, явный id занят → 409', () => {
		const a = ctx.orch.createTask({ title: 'Починить CI', owner: 'claude' })
		assert.equal(a.id, 'pochinit-ci-0000')
		assert.equal(a.status, 'active')
		assert.equal(a.owner, 'claude')
		assert.equal(a.summary, null)
		const b = ctx.orch.createTask({ title: 'Починить CI' })
		assert.equal(b.id, 'pochinit-ci-0001', 'повторный суффикс 0000 пропущен')
		assert.equal(ctx.orch.createTask({ title: 'x', id: 'mine' }).id, 'mine')
		assert.equal(code(() => ctx.orch.createTask({ title: 'y', id: 'mine' })), '409 task_exists')
		assert.deepEqual(ctx.store.tasks.map(t => t.id).sort(), ['mine', 'pochinit-ci-0000', 'pochinit-ci-0001'])
		assert.equal(ctx.hub.filter(e => e.t === 'task').length, 3)
	})

	it('update: done с итогом, reopen, неизвестная → 404', () => {
		const t = ctx.orch.createTask({ title: 'Отчёт' })
		const done = ctx.orch.updateTask(t.id, { status: 'done', summary: '**готово**' })
		assert.equal(done.status, 'done')
		assert.equal(done.summary, '**готово**')
		assert.equal(ctx.orch.listTasks('active').length, 0)
		assert.equal(ctx.orch.listTasks('done')[0]?.id, t.id)
		const again = ctx.orch.updateTask(t.id, { status: 'active' })
		assert.equal(again.summary, '**готово**', 'итог сохраняется, пока его не сбросят')
		assert.equal(code(() => ctx.orch.updateTask('nope', { title: 'x' })), '404 no_task')
		const last = ctx.hub.filter((e): e is Extract<HubEvent, { t: 'task' }> => e.t === 'task').at(-1)
		assert.equal(last?.task.status, 'active')
	})

	it('spawn: задача проверяется (no_task), агент агента наследует задачу родителя', async () => {
		const t = ctx.orch.createTask({ title: 'Ящик' })
		await assert.rejects(ctx.orch.spawn({ space: 'main', task: 'nope' }), (e: unknown) => e instanceof AppError && e.code === 'no_task')
		const parent = (await ctx.orch.spawn({ space: 'main', name: 'lead', task: t.id })).agent
		assert.equal(parent.task, t.id)
		const child = (await ctx.orch.spawn({ space: 'main', name: 'helper', from: parent.id })).agent
		assert.equal(child.task, t.id, 'наследуется от родителя')
		const loose = (await ctx.orch.spawn({ space: 'main', name: 'loose' })).agent
		assert.equal(loose.task, null)
		assert.deepEqual(ctx.orch.listAgents(t.id).map(a => a.name).sort(), ['helper', 'lead'])
		assert.equal(ctx.orch.graph().tasks.length, 1)
		assert.equal(ctx.orch.snapshot().tasks[0]?.id, t.id)
	})

	it('remove: занятый агент → 409 task_busy; иначе агенты отвязываются (task=null)', async () => {
		const t = ctx.orch.createTask({ title: 'Удаляемая' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'w', task: t.id })).agent
		const agent = ctx.orch.resolveAgent(a.id)
		agent.queue.push({ seq: 0, id: 'm-x', ts: 0, from: 'you', to: a.id, kind: 'msg', text: 'ждёт', hops: 0 })
		assert.equal(code(() => ctx.orch.removeTask(t.id)), '409 task_busy')
		agent.queue.length = 0
		ctx.orch.removeTask(t.id)
		assert.equal(ctx.orch.getAgent(a.id).task, null)
		assert.equal(code(() => ctx.orch.getTask(t.id)), '404 no_task')
		assert.ok(ctx.hub.some(e => e.t === 'task_removed' && e.id === t.id))
		assert.ok(ctx.hub.some(e => e.t === 'agent' && e.agent.id === a.id && e.agent.task === null))
	})

	it('inbox по задаче: свои ответы и свой курсор; общий inbox не трогается', async () => {
		const t1 = ctx.orch.createTask({ title: 'Первая' })
		const t2 = ctx.orch.createTask({ title: 'Вторая' })
		const a1 = (await ctx.orch.spawn({ space: 'main', name: 'a1', task: t1.id })).agent.id
		const a2 = (await ctx.orch.spawn({ space: 'main', name: 'a2', task: t2.id })).agent.id
		ctx.orch.post({ from: a1, to: 'you', kind: 'reply', text: 'от a1' })
		ctx.orch.post({ from: a2, to: 'you', kind: 'reply', text: 'от a2' })
		const r1 = await ctx.orch.inbox({ task: t1.id })
		assert.deepEqual(r1.messages.map(m => m.text), ['от a1'])
		assert.deepEqual((await ctx.orch.inbox({ task: t1.id })).messages, [], 'курсор задачи сдвинут')
		assert.deepEqual((await ctx.orch.inbox({ task: t2.id, peek: true })).messages.map(m => m.text), ['от a2'])
		assert.deepEqual((await ctx.orch.inbox({ task: t2.id })).messages.map(m => m.text), ['от a2'], 'peek не сдвинул')
		assert.deepEqual((await ctx.orch.inbox()).messages.map(m => m.text), ['от a1', 'от a2'], 'общий курсор отдельно')
		await assert.rejects(ctx.orch.inbox({ task: 'nope' }), (e: unknown) => e instanceof AppError && e.code === 'no_task')
	})

	it('long-poll задачи не просыпается от ответа чужой задачи', async () => {
		const t1 = ctx.orch.createTask({ title: 'Первая' })
		const t2 = ctx.orch.createTask({ title: 'Вторая' })
		const a1 = (await ctx.orch.spawn({ space: 'main', name: 'a1', task: t1.id })).agent.id
		const a2 = (await ctx.orch.spawn({ space: 'main', name: 'a2', task: t2.id })).agent.id
		const waiting = ctx.orch.inbox({ task: t1.id, wait: 5 })
		setTimeout(() => ctx.orch.post({ from: a2, to: 'you', kind: 'reply', text: 'чужое' }), 20)
		setTimeout(() => ctx.orch.post({ from: a1, to: 'you', kind: 'reply', text: 'своё' }), 80)
		assert.deepEqual((await waiting).messages.map(m => m.text), ['своё'])
	})

	it('рестарт: задачи, привязка агентов и курсоры задач восстанавливаются; старые агенты → task=null', async () => {
		const t = ctx.orch.createTask({ title: 'Живучая' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'keeper', task: t.id })).agent.id
		ctx.orch.post({ from: a, to: 'you', kind: 'reply', text: 'раз' })
		await ctx.orch.inbox({ task: t.id })
		await ctx.orch.shutdown()
		// агент из старой версии состояния — без поля task
		const legacy = { ...(ctx.store.state.agents[0] as (typeof ctx.store.state.agents)[number]), id: 'a-old', name: 'old' }
		delete legacy.task
		ctx.store.state.agents.push(legacy)
		const next = setup(ctx.store)
		assert.deepEqual(next.orch.listTasks().map((x: TaskView) => x.id), [t.id])
		assert.equal(next.orch.getAgent('keeper').task, t.id)
		assert.equal(next.orch.getAgent('old').task, null)
		assert.deepEqual((await next.orch.inbox({ task: t.id })).messages, [], 'курсор задачи сохранён')
		await next.orch.shutdown()
	})
})
