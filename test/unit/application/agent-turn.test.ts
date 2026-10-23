/** Агент: жизненный цикл хода — архив, прерывание, временный отказ nessy (на поддельном шлюзе). */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { history, replies, setup, startTurn, users } from '../../support/agent-test-context'
import { until } from '../../support/wait'

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
		assert.equal(ctx.gw.prompts[1], 'ещё', 'контекст прежний: без вводной и без повторного напоминания о плане (окно агента мало)')
		assert.match(ctx.gw.prompts[0] ?? '', /Веди план/, 'напоминание — в первом промпте')
		assert.equal(ctx.orch.resolveAgent(id).nessyId, session)
	})

	it('метрика контекста: занято и окно модели — оба из события context.usage', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'usage', used: 33_241, size: 524_000 })
		ctx.gw.emit({ kind: 'text', text: 'ок', messageId: 'm1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		await until(() => ctx.orch.getAgent(id).stats.contextPct === 6, 2000, 'контекст из context.usage')
		assert.equal(ctx.orch.getAgent(id).stats.contextTokens, 33_241)
	})

	it('nessy не сообщает контекст — пусто, окно по умолчанию не подставляется', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		ctx.gw.emit({ kind: 'text', text: 'ок', messageId: 'm1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		const st = ctx.orch.getAgent(id).stats
		assert.equal(st.contextPct ?? null, null)
		assert.equal(st.contextTokens ?? null, null)
	})

	it('interrupt: следующий промпт уходит только после подтверждения отмены, срочное — первым', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		await ctx.orch.send(id, { text: 'в очередь', interrupt: false })
		await ctx.orch.send(id, { text: 'срочно-1', interrupt: true })
		await ctx.orch.send(id, { text: 'срочно-2', interrupt: true })
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
		await ctx.orch.send(id, { text: 'срочно', interrupt: true })
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
		assert.ok(ctx.gw.cancels >= 1, 'промпт, принятый после закрытия хода, отменяется в nessy')
	})

	it('прерывание, пока промпт ещё летит в nessy: отмена уходит после его принятия', async () => {
		const ctx = setup()
		let release = (): void => undefined
		ctx.gw.promptGate = new Promise<void>(r => (release = r))
		const r = await ctx.orch.spawn({ space: 'main', name: 'alpha', prompt: 'сессия' })
		await until(() => ctx.gw.prompts.length === 1, 1000, 'промпт отправлен')
		await ctx.orch.send(r.agent.id, { text: 'срочно', interrupt: true })
		assert.equal(ctx.gw.cancels, 0)
		ctx.gw.promptGate = null
		release()
		await until(() => ctx.gw.cancels === 1, 1000, 'отмена после принятия промпта')
	})

	it('сообщение не прерывает ход ни от агента, ни от you (прерывание — только interrupt: true)', async () => {
		const ctx = setup()
		const id = await startTurn(ctx)
		const other = await ctx.orch.spawn({ space: 'main', name: 'beta' })
		await ctx.orch.send(id, { from: other.agent.id, text: 'вопрос' })
		await until(() => ctx.orch.getAgent(id).queued === 1, 1000, 'nessy не принял mid-turn — сообщение в очереди')
		assert.equal(ctx.gw.cancels, 0)
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
