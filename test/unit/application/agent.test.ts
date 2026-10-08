/** Агент + журнал на поддельном шлюзе: отображение событий сессии в AgentEvent и в ответы. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { beforeEach, describe, it } from 'node:test'
import type { AgentEvent, HubEvent, Message, ToolEvent } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

interface Ctx {
	orch: Orchestrator
	gw: FakeGateway
	store: MemoryStore
	hub: HubEvent[]
}

function setup(autoApprove = true): Ctx {
	const store = new MemoryStore()
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch' },
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const hub: HubEvent[] = []
	orch.hub.subscribe(e => hub.push(e))
	return { orch, gw, store, hub }
}

/** Последняя запись каждого seq (как читает история). */
function history(ctx: Ctx, id: string): AgentEvent[] {
	return ctx.orch.agentHistory(id)
}
const replies = (ctx: Ctx): Message[] => ctx.orch.listMessages({ limit: 100 }).filter(m => m.kind === 'reply')

async function startTurn(ctx: Ctx, text = 'задача'): Promise<string> {
	const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', prompt: text })
	await until(() => ctx.gw.prompts.length > 0, 2000, 'промпт отправлен')
	await until(() => ctx.orch.resolveAgent('alpha').currentMessage !== null && ctx.orch.resolveAgent('alpha').status === 'working', 2000, 'ход начат')
	await new Promise(r => setTimeout(r, 5)) // дать установиться promptId
	return r.agent.id
}

describe('агент: события сессии', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('чанки группируются по виду и messageId; ответ уходит отправителю', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit(
			{ kind: 'thought', text: 'дум', messageId: 'm1' },
			{ kind: 'thought', text: 'аю', messageId: 'm1' },
			{ kind: 'text', text: 'При', messageId: 'm1' },
			{ kind: 'text', text: 'вет', messageId: 'm1' },
			{ kind: 'text', text: 'Второе', messageId: 'm2' },
		)
		const live = ctx.orch.resolveAgent(id).liveRun()
		assert.deepEqual(live && { kind: live.kind, text: live.text, messageId: live.messageId }, { kind: 'text', text: 'Второе', messageId: 'm2' })
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		const ev = history(ctx, id).filter(e => e.kind === 'text' || e.kind === 'thought')
		assert.deepEqual(
			ev.map(e => [e.kind, 'text' in e ? e.text : '']),
			[
				['thought', 'думаю'],
				['text', 'Привет'],
				['text', 'Второе'],
			],
		)
		assert.equal(replies(ctx)[0]?.text, 'ПриветВторое')
		const chunks = ctx.hub.filter(e => e.t === 'chunk')
		assert.equal(chunks.length, 5)
		assert.equal(ctx.orch.resolveAgent(id).status, 'idle')
	})

	it('инструмент: обновления сохраняют title/name/input, статус — один из четырёх', async () => {
		const id = await startTurn(ctx)
		const base = { kind: 'tool' as const, toolId: 't1', name: 'read_file', input: { path: 'a.md' }, output: '' }
		ctx.gw.emit({ ...base, title: 'Read: a.md', status: 'pending' })
		ctx.gw.emit({ ...base, name: '', title: '', input: {}, status: 'in_progress' })
		ctx.gw.emit({ ...base, name: '', title: '', input: {}, status: 'completed', output: '# A' })
		const tools = history(ctx, id).filter((e): e is ToolEvent => e.kind === 'tool')
		assert.equal(tools.length, 1)
		assert.deepEqual(
			{ ...tools[0], seq: 0, ts: 0 },
			{ seq: 0, ts: 0, kind: 'tool', toolId: 't1', name: 'read_file', title: 'Read: a.md', input: { path: 'a.md' }, status: 'completed', output: '# A' },
		)
		const published = ctx.hub.filter(e => e.t === 'event' && e.event.kind === 'tool').map(e => (e.t === 'event' && e.event.kind === 'tool' ? e.event.status : ''))
		assert.deepEqual(published, ['pending', 'in_progress', 'completed'])
		assert.deepEqual(ctx.orch.getAgent(id).lastTool, { name: 'read_file', title: 'Read: a.md' })
	})

	it('nessy/error → системное событие error и ответ с failed', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'turn_error', message: 'Rate limit exceeded', retryable: true, code: 429 })
		assert.equal(ctx.orch.resolveAgent(id).status, 'working') // ждём turn_complete
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		const sys = history(ctx, id).filter(e => e.kind === 'system' && e.level === 'error')
		assert.ok(sys.some(e => e.kind === 'system' && /Rate limit exceeded/.test(e.text)))
		const r = replies(ctx)[0]
		assert.equal(r?.failed, 'Rate limit exceeded')
		assert.equal(ctx.orch.getAgent(id).error, 'Rate limit exceeded')
		assert.equal(ctx.orch.getAgent(id).status, 'idle')
	})

	it('prompt_cancelled → «ход прерван», открытые инструменты failed, повторный turn_complete игнорируется', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'tool', toolId: 't1', name: 'run_shell_command', title: 'Shell: sleep', input: {}, status: 'in_progress', output: '' })
		ctx.gw.emit({ kind: 'cancelled', promptId: 'p-1' }, { kind: 'turn_complete', stopReason: 'cancelled', promptId: 'p-1' })
		const ev = history(ctx, id)
		assert.ok(ev.some(e => e.kind === 'system' && e.level === 'info' && e.text === 'ход прерван'))
		assert.equal(ev.find((e): e is ToolEvent => e.kind === 'tool')?.status, 'failed')
		assert.equal(replies(ctx).length, 1)
		assert.equal(replies(ctx)[0]?.text, '(ход прерван)')
	})

	it('устаревший turn_complete (чужой promptId) не завершает ход', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-старый' })
		assert.equal(ctx.orch.resolveAgent(id).status, 'working')
	})

	it('события вне хода (реплей) игнорируются, followup — тоже', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		const before = history(ctx, id).length
		ctx.gw.emit({ kind: 'text', text: 'реплей', messageId: null }, { kind: 'tool', toolId: 'old', name: 'x', title: 'x', input: {}, status: 'completed', output: '' }, { kind: 'followup', text: '?' })
		assert.equal(history(ctx, id).length, before)
	})

	it('meta → displayName; died → dead и ответ с ошибкой', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'meta', displayName: 'Обзор' }, { kind: 'died', reason: 'процесс умер' })
		const a = ctx.orch.getAgent(id)
		assert.equal(a.displayName, 'Обзор')
		assert.equal(a.status, 'dead')
		assert.equal(replies(ctx)[0]?.failed, 'процесс умер')
	})
})

describe('агент: разрешения', () => {
	it('автоподтверждение голосует allow и пишет аудит', async () => {
		const ctx = setup(true)
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'permission', requestId: 'r1', title: 'Shell: rm', options: [{ optionId: 'proceed_once', kind: 'allow_once', name: 'Да' }] })
		await until(() => ctx.gw.votes.length === 1, 1000, 'голос')
		assert.deepEqual(ctx.gw.votes[0], { requestId: 'r1', optionId: 'proceed_once' })
		assert.ok(history(ctx, id).some(e => e.kind === 'permission' && e.auto === true && e.approved === true))
	})
	it('ручной режим: запрос ждёт решения; отклонение голосует reject', async () => {
		const ctx = setup(false)
		const id = await startTurn(ctx)
		ctx.gw.emit({
			kind: 'permission',
			requestId: 'r1',
			title: 'Shell: rm',
			options: [
				{ optionId: 'proceed_once', kind: 'allow_once', name: 'Да' },
				{ optionId: 'cancel', kind: 'reject_once', name: 'Нет' },
			],
		})
		assert.deepEqual(ctx.orch.getAgent(id).pendingPermissions, [{ requestId: 'r1', title: 'Shell: rm' }])
		assert.equal(ctx.gw.votes.length, 0)
		assert.equal(await ctx.orch.resolvePermission(id, 'r1', false), true)
		assert.deepEqual(ctx.gw.votes[0], { requestId: 'r1', optionId: 'cancel' })
		assert.deepEqual(ctx.orch.getAgent(id).pendingPermissions, [])
		assert.equal(await ctx.orch.resolvePermission(id, 'r1', true), false)
	})
})
