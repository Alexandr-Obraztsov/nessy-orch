/** Агент + журнал на поддельном шлюзе: отображение событий сессии в AgentEvent и в ответы. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { beforeEach, describe, it } from 'node:test'
import type { AgentEvent, HubEvent, Message, ToolEvent } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { planReminder } from '../../../src/domain/preamble'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

interface Ctx {
	orch: Orchestrator
	gw: FakeGateway
	store: MemoryStore
	hub: HubEvent[]
}

function setup(autoApprove = true, cancelGraceMs = 3000): Ctx {
	const store = new MemoryStore()
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', cancelGraceMs },
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

async function startTurn(ctx: Ctx, text = 'сессия'): Promise<string> {
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
		assert.equal(replies(ctx)[0]?.text, 'Второе', 'результат — только финальное сообщение')
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
			{ ...tools[0], seq: 0, ts: 0, endedTs: 0 },
			{ seq: 0, ts: 0, endedTs: 0, kind: 'tool', toolId: 't1', name: 'read_file', title: 'Read: a.md', input: { path: 'a.md' }, status: 'completed', output: '# A' },
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
		assert.equal(ctx.orch.getAgent(id).status, 'error')
		assert.equal(ctx.orch.getAgent(id).archived, false, 'ошибка — агент остаётся на виду')
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

	it('meta → displayName; died → error и ответ с ошибкой', async () => {
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'meta', displayName: 'Обзор' }, { kind: 'died', reason: 'процесс умер' })
		const a = ctx.orch.getAgent(id)
		assert.equal(a.displayName, 'Обзор')
		assert.equal(a.status, 'error')
		assert.equal(a.error, 'процесс умер')
		assert.equal(a.archived, false)
		assert.equal(replies(ctx)[0]?.failed, 'процесс умер')
	})
})

describe('агент: результат хода — финальное сообщение', () => {
	it('промежуточный текст между инструментами — в истории, но не в ответе', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		const tool = (toolId: string) => ({ kind: 'tool', toolId, name: 'grep', title: toolId, input: {}, status: 'completed', output: '' }) as const
		ctx.gw.emit(
			{ kind: 'text', text: 'Сначала ', messageId: 'm1' },
			{ kind: 'text', text: 'поищу.', messageId: 'm1' },
			tool('t1'),
			{ kind: 'text', text: 'Нашёл, проверю.', messageId: 'm1' }, // тот же messageId, но после инструмента — новый блок
			tool('t2'),
			{ kind: 'thought', text: 'свожу', messageId: 'm2' },
			{ kind: 'text', text: 'Итог: ', messageId: 'm2' },
			{ kind: 'text', text: 'всё хорошо.', messageId: 'm2' },
			{ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' },
		)
		assert.equal(replies(ctx)[0]?.text, 'Итог: всё хорошо.')
		assert.equal(ctx.orch.getAgent(id).preview, 'Итог: всё хорошо.')
		const texts = history(ctx, id).flatMap(e => (e.kind === 'text' ? [e.text] : []))
		assert.deepEqual(texts, ['Сначала поищу.', 'Нашёл, проверю.', 'Итог: всё хорошо.'])
	})

	it('после последнего инструмента текста нет — последний непустой блок хода', async () => {
		const ctx = setup()
		await startTurn(ctx)
		ctx.gw.emit(
			{ kind: 'text', text: 'Промежуточно.', messageId: 'm1' },
			{ kind: 'text', text: 'Ответ.', messageId: 'm2' },
			{ kind: 'tool', toolId: 't1', name: 'grep', title: 't1', input: {}, status: 'completed', output: '' },
			{ kind: 'text', text: '  ', messageId: 'm3' },
			{ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' },
		)
		assert.equal(replies(ctx)[0]?.text, 'Ответ.')
	})

	it('прерванный ход с промежуточным текстом — «(ход прерван)»', async () => {
		const ctx = setup()
		await startTurn(ctx)
		ctx.gw.emit({ kind: 'text', text: 'начинаю', messageId: 'm1' }, { kind: 'cancelled', promptId: 'p-1' })
		assert.match(replies(ctx)[0]?.text ?? '', /ход прерван/)
	})
})

describe('агент: напоминание о плане', () => {
	const tool = (toolId: string) => ({ kind: 'tool', toolId, name: 'grep', title: toolId, input: {}, status: 'in_progress', output: '' }) as const
	const warnings = (ctx: Ctx, id: string): AgentEvent[] => history(ctx, id).filter(e => e.kind === 'system' && e.text === 'агент не опубликовал план')

	it('в промпт добавлено напоминание, в истории — исходный текст', async () => {
		const ctx = setup()
		const id = await startTurn(ctx, 'сделай дело')
		const prompt = ctx.gw.prompts[0] ?? ''
		assert.ok(prompt.endsWith(`сделай дело\n\n${planReminder(id, 'nessy-orch')}`))
		assert.match(planReminder(id, 'nessy-orch'), new RegExp(`^\\[nessy-orch\\] Веди план: .*nessy-orch plan --from ${id}`))
		assert.ok(!planReminder(id, 'nessy-orch').includes('\n'), 'одна строка')
		assert.deepEqual(users(ctx, id), ['сделай дело'])
	})

	it('3 инструмента без плана в ходе — одно системное предупреждение', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		ctx.gw.emit(tool('t1'), tool('t2'))
		assert.equal(warnings(ctx, id).length, 0)
		ctx.gw.emit(tool('t3'), tool('t4'), tool('t5'))
		assert.equal(warnings(ctx, id).length, 1)
	})

	it('план опубликован в ходе — предупреждения нет', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		ctx.orch.setPlan(id, { from: id, entries: [{ content: 'шаг', status: 'in_progress' }] })
		ctx.gw.emit(tool('t1'), tool('t2'), tool('t3'))
		assert.equal(warnings(ctx, id).length, 0)
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

const users = (ctx: Ctx, id: string): string[] => history(ctx, id).flatMap(e => (e.kind === 'user' ? [e.text] : []))

describe('агент: архив и прерывание', () => {
	it('успешный ход → архив; сообщение возвращает из архива в той же сессии', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		const session = ctx.orch.resolveAgent(id).nessyId
		ctx.gw.emit({ kind: 'text', text: 'готово', messageId: 'm1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		assert.equal(ctx.orch.getAgent(id).archived, true)
		assert.equal(ctx.orch.getAgent(id).status, 'idle')
		await ctx.orch.send(id, { text: 'ещё' })
		assert.equal(ctx.orch.getAgent(id).archived, false)
		await until(() => ctx.gw.prompts.length === 2, 1000, 'второй промпт')
		assert.equal(ctx.gw.prompts[1], `ещё\n\n${planReminder(id, 'nessy-orch')}`, 'контекст прежний — без повторной вводной')
		assert.equal(ctx.orch.resolveAgent(id).nessyId, session)
	})

	it('interrupt: следующий промпт уходит только после подтверждения отмены, срочное — первым', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		await ctx.orch.send(id, { text: 'в очередь', interrupt: false })
		await ctx.orch.send(id, { text: 'срочно-1' })
		await ctx.orch.send(id, { text: 'срочно-2' })
		assert.equal(ctx.gw.cancels, 1, 'отмена отправлена один раз')
		assert.equal(ctx.gw.prompts.length, 1, 'до подтверждения новый промпт не отправлен')
		ctx.gw.emit({ kind: 'cancelled', promptId: 'p-1' })
		await until(() => ctx.gw.prompts.length === 2, 1000, 'промпт после отмены')
		assert.equal(replies(ctx)[0]?.text, '(ход прерван)')
		// поздний turn_complete прерванного промпта не завершает новый ход
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'cancelled', promptId: 'p-1' })
		assert.equal(ctx.orch.getAgent(id).status, 'working')
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-2' })
		await until(() => ctx.gw.prompts.length === 3, 1000, 'третий промпт')
		ctx.gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-3' })
		await until(() => ctx.gw.prompts.length === 4, 1000, 'четвёртый промпт')
		assert.deepEqual(users(ctx, id), ['сессия', 'срочно-1', 'срочно-2', 'в очередь'])
	})

	it('nessy не подтвердил отмену: по таймауту ход закрывается, события старого промпта игнорируются', async () => {
		const ctx = setup(true, 40)
		const id = await startTurn(ctx)
		let release = (): void => undefined
		ctx.gw.promptGate = new Promise<void>(r => (release = r))
		await ctx.orch.send(id, { text: 'срочно' })
		await until(() => ctx.gw.prompts.length === 2, 1000, 'промпт после таймаута')
		assert.equal(replies(ctx)[0]?.text, '(ход прерван)')
		assert.ok(history(ctx, id).some(e => e.kind === 'system' && /не подтвердил отмену/.test(e.text)))
		// пока nessy не принял новый промпт, хвост старого не попадает в новый ход
		ctx.gw.emit({ kind: 'text', text: 'хвост старого', messageId: 'old' }, { kind: 'turn_complete', stopReason: 'cancelled', promptId: 'p-1' })
		release()
		ctx.gw.promptGate = null
		await new Promise(r => setTimeout(r, 5))
		ctx.gw.emit({ kind: 'text', text: 'новый ответ', messageId: 'new' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-2' })
		assert.equal(replies(ctx)[1]?.text, 'новый ответ')
		assert.ok(!history(ctx, id).some(e => e.kind === 'text' && /хвост старого/.test(e.text)))
	})

	it('прерывание, пока промпт ещё летит в nessy: отмена уходит после его принятия', async () => {
		const ctx = setup()
		let release = (): void => undefined
		ctx.gw.promptGate = new Promise<void>(r => (release = r))
		const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', prompt: 'сессия' })
		await until(() => ctx.gw.prompts.length === 1, 1000, 'промпт отправлен')
		await ctx.orch.send(r.agent.id, { text: 'срочно' })
		assert.equal(ctx.gw.cancels, 0)
		ctx.gw.promptGate = null
		release()
		await until(() => ctx.gw.cancels === 1, 1000, 'отмена после принятия промпта')
	})

	it('сообщение агента не прерывает ход (interrupt по умолчанию только у you)', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		const other = await ctx.orch.spawn({ space: 'main', name: 'beta' })
		await ctx.orch.send(id, { from: other.agent.id, text: 'вопрос' })
		assert.equal(ctx.gw.cancels, 0)
		assert.equal(ctx.orch.getAgent(id).queued, 1)
	})
})

describe('агент: временный отказ nessy', () => {
	it('prompt_queue_full → промпт повторяется, ход не падает', async () => {
		const ctx = setup()
		ctx.gw.busyPrompts = 2
		const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', prompt: 'сессия' })
		await until(() => ctx.gw.prompts.length === 3, 3000, 'два отказа и успешная отправка')
		const a = ctx.orch.resolveAgent(r.agent.id)
		assert.equal(a.status, 'working')
		assert.equal(a.error, null)
		assert.equal(history(ctx, r.agent.id).filter(e => e.kind === 'system' && e.text.includes('nessy занят')).length, 1, 'об ожидании пишем один раз')
	})
})
