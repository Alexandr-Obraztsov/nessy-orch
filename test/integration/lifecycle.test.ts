/** Жизненный цикл хода: инструменты, ошибки, прерывание, разрешения, падение сессии, удаление. */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AgentEvent, AgentView, ApiError, Message, SendResponse, SpawnResponse, ToolEvent, UserEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 25000 }
const tools = (ev: AgentEvent[]): ToolEvent[] => ev.filter((e): e is ToolEvent => e.kind === 'tool')

describe('ход агента (автоподтверждение)', () => {
	let h: Harness
	const msgs = (): Message[] => h.orch.listMessages({ limit: 1000 })
	before(async () => {
		h = await startHarness()
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
		await h.api('POST', '/agents', { space: 'main', name: 'worker' })
		await until(() => h.orch.getAgent('worker').status === 'idle', 10000, 'worker подключён')
	})
	after(() => h.close())

	it('#tools: три инструмента с заголовками, входом и выводом, статус completed', T, async () => {
		const r = await h.api<SendResponse>('POST', '/agents/worker/send', { text: '#tools', wait: true, waitTimeoutSec: 15 })
		assert.match(r.body.reply?.text ?? '', /тесты зелёные/)
		const list = tools(h.orch.agentHistory('worker'))
		assert.deepEqual(
			list.map(t => [t.name, t.title, t.status]),
			[
				['read_file', 'Read: README.md', 'completed'],
				['grep', 'Grep: TODO', 'completed'],
				['run_shell_command', 'Shell: npm test', 'completed'],
			],
		)
		const [first] = list
		assert.ok(first)
		assert.deepEqual(first.input, { path: 'README.md' })
		assert.match(first.output ?? '', /^# nessy-orch/)
		assert.equal((await h.api<AgentView>('GET', '/agents/worker')).body.lastTool?.name, 'run_shell_command')
		const hist = await h.api<AgentEvent[]>('GET', '/agents/worker/history?limit=1000')
		assert.equal(tools(hist.body).length, 3, 'история отдаёт одну запись на инструмент')
	})

	it('#perm при автоподтверждении: голос «разрешить», аудит, инструмент выполнен', T, async () => {
		const r = await h.api<SendResponse>('POST', '/agents/worker/send', { text: '#perm ls -la', wait: true, waitTimeoutSec: 15 })
		assert.equal(r.body.reply?.text, 'выполнено: ls -la')
		const ev = h.orch.agentHistory('worker')
		assert.ok(ev.some(e => e.kind === 'permission' && e.auto === true && e.approved === true && e.title === 'Shell: ls -la'))
	})

	it('#error: ошибка хода — системное событие error, ответ с failed, агент жив', T, async () => {
		const r = await h.api<SendResponse>('POST', '/agents/worker/send', { text: '#error', wait: true, waitTimeoutSec: 10 })
		assert.equal(r.body.reply?.failed, 'Rate limit exceeded')
		assert.match(r.body.reply.text, /^⚠ ошибка: Rate limit exceeded/)
		const ev = h.orch.agentHistory('worker')
		assert.ok(ev.some(e => e.kind === 'system' && e.level === 'error' && /Rate limit exceeded/.test(e.text)))
		assert.ok(!ev.some(e => e.kind === 'text' && /Rate limit/.test(e.text)), 'ошибка не попала в текст')
		const failed = h.orch.getAgent('worker')
		assert.equal(failed.status, 'error')
		assert.equal(failed.error, 'Rate limit exceeded')
		assert.equal(failed.archived, false, 'ход с ошибкой — агент остаётся на виду')
		const ok = await h.api<SendResponse>('POST', '/agents/worker/send', { text: 'снова', wait: true, waitTimeoutSec: 10 })
		assert.equal(ok.body.reply?.text, 'ответ: снова')
		assert.equal(h.orch.getAgent('worker').error, null)
		assert.equal(h.orch.getAgent('worker').status, 'idle')
		assert.equal(h.orch.getAgent('worker').archived, true, 'успешный ход — в архив')
	})

	it('cancel прерывает ход: «ход прерван», очередь очищена, агент idle', T, async () => {
		await h.api('POST', '/agents/worker/send', { text: '#slow' })
		await until(() => h.orch.getAgent('worker').status === 'working', 4000, 'working')
		await h.api('POST', '/agents/worker/send', { text: 'в очереди', interrupt: false })
		const c = await h.api<AgentView>('POST', '/agents/worker/cancel', {})
		assert.equal(c.status, 200)
		assert.equal(c.body.queued, 0)
		await until(() => h.orch.getAgent('worker').status === 'idle', 6000, 'idle')
		const ev = h.orch.agentHistory('worker')
		assert.ok(ev.some(e => e.kind === 'system' && e.text === 'ход прерван'))
		await new Promise(r => setTimeout(r, 300))
		assert.ok(!ev.some(e => e.kind === 'user' && e.text === 'в очереди'), 'очередь не доставлена')
		assert.equal(msgs().filter(m => m.kind === 'reply' && /\(ход прерван\)$/.test(m.text)).length, 1)
		assert.equal(h.orch.getAgent('worker').archived, false, 'прерванный ход не уводит в архив')
	})

	it('падение сессии nessy → error; следующее сообщение создаёт новую сессию', T, async () => {
		await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'doomed' })
		await until(() => h.orch.resolveAgent('doomed').sessionId !== null, 8000, 'сессия создана')
		const sessionBefore = h.orch.resolveAgent('doomed').sessionId
		const r = await h.api<SendResponse>('POST', '/agents/doomed/send', { text: '#fail', wait: true, waitTimeoutSec: 8 })
		assert.ok(r.body.reply?.failed, 'ответ помечен ошибкой')
		const dead = h.orch.getAgent('doomed')
		assert.equal(dead.status, 'error')
		assert.ok(dead.error)
		assert.equal(dead.archived, false)
		assert.ok(h.orch.agentHistory('doomed').some(e => e.kind === 'system' && e.level === 'error' && /сессия nessy завершилась/.test(e.text)))
		const again = await h.api<SendResponse>('POST', '/agents/doomed/send', { text: 'ещё', wait: true, waitTimeoutSec: 8 })
		assert.equal(again.status, 200)
		assert.equal(again.body.reply?.text, 'ответ: ещё')
		assert.equal(again.body.reply.failed, undefined)
		assert.notEqual(h.orch.resolveAgent('doomed').sessionId, sessionBefore, 'новая сессия')
		assert.ok(h.orch.agentHistory('doomed').some(e => e.kind === 'system' && e.text === 'сессия nessy пересоздана, контекст сброшен'))
		assert.equal(h.orch.getAgent('doomed').status, 'idle')
		assert.equal(h.orch.getAgent('doomed').error, null)
		const first = h.orch.agentHistory('doomed').filter((e): e is UserEvent => e.kind === 'user').at(-1)
		assert.equal(first?.text, 'ещё')
	})

	it('удаление агента: история архивируется, ссылки по имени больше не работают', T, async () => {
		assert.equal((await h.api('DELETE', '/agents/doomed')).status, 200)
		assert.equal((await h.api<ApiError>('GET', '/agents/doomed')).status, 404)
		assert.ok(msgs().some(m => m.kind === 'event' && /удалён/.test(m.text)))
	})
})

describe('ручное подтверждение прав (ORCH_AUTO_APPROVE=0)', () => {
	let h: Harness
	before(async () => {
		h = await startHarness({ config: { autoApprove: false } })
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
	})
	after(() => h.close())

	it('запрос копится в pendingPermissions, approve через API продолжает ход', T, async () => {
		const sp = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'careful', prompt: '#perm rm -rf build' })
		assert.equal(sp.status, 201)
		await until(() => h.orch.getAgent('careful').pendingPermissions.length === 1, 8000, 'запрос разрешения')
		const pending = h.orch.getAgent('careful').pendingPermissions[0]
		assert.equal(pending?.title, 'Shell: rm -rf build')
		assert.equal(h.orch.getAgent('careful').status, 'working')
		assert.ok(h.orch.agentHistory('careful').some(e => e.kind === 'permission' && !e.resolved))
		const bad = await h.api<{ ok: boolean }>('POST', '/agents/careful/permission/nope', { approve: true })
		assert.equal(bad.status, 404)
		const ok = await h.api<{ ok: boolean }>('POST', `/agents/careful/permission/${pending.requestId}`, { approve: true })
		assert.deepEqual(ok.body, { ok: true })
		await until(() => h.orch.getAgent('careful').status === 'idle', 8000, 'ход завершён')
		assert.equal(h.orch.getAgent('careful').pendingPermissions.length, 0)
		const ev = h.orch.agentHistory('careful')
		assert.ok(ev.some(e => e.kind === 'permission' && e.resolved && e.approved === true && e.auto === false))
		assert.equal(tools(ev)[0]?.status, 'completed')
		assert.equal(h.orch.listMessages({ agent: 'careful' }).find(m => m.kind === 'reply')?.text, 'выполнено: rm -rf build')
	})

	it('отклонение: инструмент не запускается', T, async () => {
		await h.api('POST', '/agents/careful/send', { text: '#perm shutdown now' })
		await until(() => h.orch.getAgent('careful').pendingPermissions.length === 1, 8000, 'запрос разрешения')
		const id = h.orch.getAgent('careful').pendingPermissions[0]?.requestId ?? ''
		await h.api('POST', `/agents/careful/permission/${id}`, { approve: false })
		await until(() => h.orch.getAgent('careful').status === 'idle', 8000, 'ход завершён')
		const last = h.orch.listMessages({ agent: 'careful' }).filter(m => m.kind === 'reply').pop()
		assert.equal(last?.text, 'пользователь отклонил команду')
		assert.ok(h.orch.agentHistory('careful').some(e => e.kind === 'permission' && e.resolved && e.approved === false))
	})
})
