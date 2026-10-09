/** Задачи по HTTP: CRUD, spawn в задаче и наследование, inbox по задачам (два оркестратора), поток, рестарт. */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AgentView, ApiError, GraphView, InboxResponse, SpawnResponse, StreamEvent, TaskView } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 30000 }

describe('задачи (HTTP)', () => {
	let h: Harness
	let t1: TaskView
	let t2: TaskView

	before(async () => {
		h = await startHarness()
		assert.equal((await h.api('POST', '/spaces', { path: h.ws, name: 'main' })).status, 201)
	})
	after(() => h.close())

	it('POST /tasks: id из заголовка + 4 hex; явный id; ошибки', T, async () => {
		const r = await h.api<TaskView>('POST', '/tasks', { title: 'Починить CI', owner: 'claude-1' })
		assert.equal(r.status, 201)
		t1 = r.body
		assert.match(t1.id, /^pochinit-ci-[0-9a-f]{4}$/)
		assert.equal(t1.owner, 'claude-1')
		assert.equal(t1.status, 'active')
		const r2 = await h.api<TaskView>('POST', '/tasks', { title: 'Обзор MR', owner: 'claude-2', id: 'review-mr' })
		t2 = r2.body
		assert.equal(t2.id, 'review-mr')
		const dup = await h.api<ApiError>('POST', '/tasks', { title: 'x', id: 'review-mr' })
		assert.equal(dup.status, 409)
		assert.equal(dup.body.code, 'task_exists')
		assert.equal((await h.api<ApiError>('POST', '/tasks', { owner: 'x' })).status, 400)
		assert.equal((await h.api<ApiError>('GET', '/tasks/nope')).body.code, 'no_task')
		assert.equal((await h.api<TaskView>('GET', `/tasks/${t1.id}`)).body.title, 'Починить CI')
		assert.equal((await h.api<TaskView[]>('GET', '/tasks')).body.length, 2)
		assert.equal((await h.api<GraphView>('GET', '/graph')).body.tasks.length, 2)
	})

	it('POST /agents с task: проверка no_task, наследование задачи от агента-родителя, GET /agents?task=', T, async () => {
		const bad = await h.api<ApiError>('POST', '/agents', { space: 'main', task: 'nope' })
		assert.equal(bad.status, 404)
		assert.equal(bad.body.code, 'no_task')
		const lead = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'lead-1', task: t1.id })
		assert.equal(lead.body.agent.task, t1.id)
		const sub = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'sub-1', from: lead.body.agent.id })
		assert.equal(sub.body.agent.task, t1.id, 'агент, запущенный агентом, наследует задачу')
		await h.api('POST', '/agents', { space: 'main', name: 'lead-2', task: t2.id })
		const in1 = await h.api<AgentView[]>('GET', `/agents?task=${t1.id}`)
		assert.deepEqual(in1.body.map(a => a.name).sort(), ['lead-1', 'sub-1'])
		assert.equal((await h.api<ApiError>('GET', '/agents?task=nope')).status, 404)
		assert.equal((await h.api<AgentView[]>('GET', '/agents')).body.length, 3)
	})

	it('два оркестратора: у каждой задачи свой inbox и курсор, ответы не крадутся', T, async () => {
		await h.api('GET', '/inbox') // общий курсор — в конец
		const w1 = h.api<InboxResponse>('GET', `/inbox?task=${t1.id}&wait=10`)
		const w2 = h.api<InboxResponse>('GET', `/inbox?task=${t2.id}&wait=10`)
		await h.api('POST', '/agents/lead-2/send', { text: 'для второго' })
		await h.api('POST', '/agents/lead-1/send', { text: 'для первого' })
		const [r1, r2] = await Promise.all([w1, w2])
		assert.deepEqual(r1.body.messages.map(m => m.text), ['ответ: для первого'])
		assert.deepEqual(r2.body.messages.map(m => m.text), ['ответ: для второго'])
		assert.deepEqual((await h.api<InboxResponse>('GET', `/inbox?task=${t1.id}`)).body.messages, [], 'курсор первой задачи сдвинут')
		assert.deepEqual((await h.api<InboxResponse>('GET', `/inbox?task=${t2.id}&peek=1`)).body.messages, [])
		// прежний общий inbox без task видит всё, со своим курсором
		const all = await h.api<InboxResponse>('GET', '/inbox?peek=1')
		assert.deepEqual(all.body.messages.map(m => m.text).sort(), ['ответ: для второго', 'ответ: для первого'])
		const again = await h.api<InboxResponse>('GET', `/inbox?task=${t1.id}&after=0`)
		assert.equal(again.body.messages.length, 1, 'after читает с позиции, не двигая курсор')
		assert.equal((await h.api<ApiError>('GET', '/inbox?task=nope')).body.code, 'no_task')
	})

	it('PATCH /tasks/:id: done с итогом и reopen; события task в /stream', T, async () => {
		const s = await h.sse('/stream')
		const snap = await s.waitFor((e): e is Extract<StreamEvent, { t: 'snapshot' }> => (e as StreamEvent).t === 'snapshot')
		assert.equal(snap.tasks.length, 2)
		const d = await h.api<TaskView>('PATCH', `/tasks/${t2.id}`, { status: 'done', summary: 'итог: готово' })
		assert.equal(d.status, 200)
		assert.equal(d.body.status, 'done')
		assert.equal(d.body.summary, 'итог: готово')
		await s.waitFor((e): e is StreamEvent => (e as StreamEvent).t === 'task' && (e as Extract<StreamEvent, { t: 'task' }>).task.status === 'done')
		assert.equal((await h.api<TaskView[]>('GET', '/tasks?status=active')).body.length, 1)
		assert.equal((await h.api<ApiError>('PATCH', `/tasks/${t2.id}`, { status: 'closed' })).status, 400)
		assert.equal((await h.api<TaskView>('PATCH', `/tasks/${t2.id}`, { status: 'active' })).body.status, 'active')
		s.close()
	})

	it('DELETE /tasks/:id: занятая задача → 409, свободная удаляется, агенты остаются с task=null', T, async () => {
		await h.api('POST', '/agents/lead-2/send', { text: '#slow' })
		await until(() => h.orch.getAgent('lead-2').status === 'working', 8000, 'агент работает')
		const busy = await h.api<ApiError>('DELETE', `/tasks/${t2.id}`)
		assert.equal(busy.status, 409)
		assert.equal(busy.body.code, 'task_busy')
		await h.api('POST', '/agents/lead-2/cancel', {})
		await until(() => h.orch.getAgent('lead-2').status !== 'working' && !h.orch.resolveAgent('lead-2').queue.length, 8000, 'агент свободен')
		const s = await h.sse('/stream')
		assert.equal((await h.api('DELETE', `/tasks/${t2.id}`)).status, 200)
		await s.waitFor((e): e is StreamEvent => (e as StreamEvent).t === 'task_removed')
		s.close()
		assert.equal(h.orch.getAgent('lead-2').task, null)
		assert.equal((await h.api('GET', `/tasks/${t2.id}`)).status, 404)
	})

	it('рестарт: задачи и привязка агентов восстанавливаются', T, async () => {
		const base = h.base
		await h.close({ keepFiles: true })
		h = await startHarness({ base })
		assert.deepEqual(h.orch.listTasks().map(t => t.id), [t1.id])
		assert.equal(h.orch.getAgent('lead-1').task, t1.id)
		assert.equal(h.orch.getAgent('sub-1').task, t1.id)
		assert.deepEqual((await h.api<InboxResponse>('GET', `/inbox?task=${t1.id}`)).body.messages, [], 'курсор задачи сохранён')
	})
})
