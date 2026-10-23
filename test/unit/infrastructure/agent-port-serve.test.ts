import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NessyServeAdapter } from '../../../src/infrastructure/nessy/agent-port-serve'
import { AppError } from '../../../src/domain/errors'
import type { NessyGateway, SessionEvent, SessionSubscription, SubscribeOptions } from '../../../src/application/ports'

/** Фейковый NessyGateway: записывает вызовы, умеет выдавать нативные SessionEvent. */
class FakeGateway implements NessyGateway {
	calls: string[] = []
	private handler: ((ev: SessionEvent, eventId: number | null) => void) | null = null
	/** результат midTurn (переопределяемо для теста mid_turn.send=false) */
	midTurnResult = true
	/** ошибка постановки промпта (null — успех) */
	promptError: Error | null = null
	/** был ли вызван sub.close() текущей подписки */
	subClosed = false

	health = (): Promise<boolean> => Promise.resolve(true)
	createSession = (cwd: string): Promise<{ sessionId: string }> => {
		this.calls.push(`create:${cwd}`)
		return Promise.resolve({ sessionId: 'sess_1' })
	}
	restoreSession = (sessionId: string, _cwd: string): Promise<{ lastEventId: number | null } | null> => {
		this.calls.push(`restore:${sessionId}`)
		return Promise.resolve(sessionId === 'missing' ? null : { lastEventId: 7 })
	}
	midTurn = (sessionId: string, _msg: string): Promise<boolean> => {
		this.calls.push(`midTurn:${sessionId}`)
		return Promise.resolve(this.midTurnResult)
	}
	prompt = (sessionId: string, _text: string): Promise<{ promptId: string | null }> => {
		this.calls.push(`prompt:${sessionId}`)
		if (this.promptError) return Promise.reject(this.promptError)
		return Promise.resolve({ promptId: 'p_1' })
	}
	usage = (): Promise<null> => Promise.resolve(null)
	contextUsage = (): Promise<null> => Promise.resolve(null)
	cancel = (sessionId: string): Promise<void> => {
		this.calls.push(`cancel:${sessionId}`)
		return Promise.resolve()
	}
	closeSession = (sessionId: string): Promise<void> => {
		this.calls.push(`close:${sessionId}`)
		return Promise.resolve()
	}
	vote = (sessionId: string, requestId: string, optionId: string | null): Promise<void> => {
		this.calls.push(`vote:${sessionId}:${requestId}:${optionId}`)
		return Promise.resolve()
	}
	subscribe(sessionId: string, opts: SubscribeOptions): SessionSubscription {
		this.calls.push(`subscribe:${sessionId}`)
		this.handler = opts.onEvent
		return {
			close: (): void => {
				this.subClosed = true
				this.handler = null
			},
		}
	}

	/** Выдать нативное событие через обработчик текущей подписки. */
	emitNative(ev: SessionEvent, eventId: number): void {
		this.handler?.(ev, eventId)
	}
}

const adapter = (g: FakeGateway): NessyServeAdapter => new NessyServeAdapter({ client: g, cwd: '/ws', clock: { now: () => 123 } })

describe('NessyServeAdapter', () => {
	it('capabilities: setModel=false, остальные true', () => {
		assert.deepEqual(adapter(new FakeGateway()).capabilities, { streamText: true, midTurn: true, permissionVote: true, setModel: false })
	})

	it('sessionCreate пробрасывает cwd и возвращает sessionId', async () => {
		const g = new FakeGateway()
		const r = await adapter(g).sessionCreate('/ignored')
		assert.equal(r.sessionId, 'sess_1')
		assert.deepEqual(g.calls, ['create:/ws'])
	})

	it('sessionResume: отсутствующая сессия → null; lastSeq в adapter-space', async () => {
		const a = adapter(new FakeGateway())
		assert.equal(await a.sessionResume('missing'), null)
		// свежая сессия без доставленных нативных событий → adapter-space пуст, lastSeq null
		assert.deepEqual(await a.sessionResume('sess_1'), { lastSeq: null })
	})

	it('sessionResume возвращает adapter-seq, соответствующий транспортному id', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		a.subscribe(id, { onEvent: () => undefined })
		// session.ready — seq 1 (синтез, без транспортного id); нативные события: seq 2→transport 1, seq 3→transport 2
		g.emitNative({ kind: 'text', text: 'a', messageId: 'm1' }, 1)
		g.emitNative({ kind: 'text', text: 'b', messageId: 'm1' }, 2)
		// restore вернул транспортный lastEventId=7 → adapter-seq последнего нативного события с transport ≤ 7 = 3
		assert.deepEqual(await a.sessionResume(id), { lastSeq: 3 })
	})

	it('promptSend синтезирует turn.started и возвращает promptId', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const got: string[] = []
		await a.sessionCreate('/ws')
		const id = (await a.sessionCreate()).sessionId
		a.subscribe(id, { onEvent: e => got.push(e.type) })
		const r = await a.promptSend(id, 'привет')
		assert.equal(r.promptId, 'p_1')
		assert.ok(got.includes('session.ready'))
		assert.ok(got.includes('turn.started'))
	})

	it('subscribe синтезирует session.ready и отдаёт валидные конверты', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const got: Record<string, unknown>[] = []
		a.subscribe(id, { onEvent: e => got.push({ v: e.v, type: e.type, seq: e.seq, ts: e.ts }) })
		g.emitNative({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }, 3)
		const ready = got.find(e => e.type === 'session.ready')
		assert.deepEqual(ready, { v: 1, type: 'session.ready', seq: 1, ts: 123 })
		// нативный turn_complete получает следующий монотонный seq (2), а не транспортный id (3)
		const completed = got.find(e => e.type === 'turn.completed')
		assert.deepEqual(completed, { v: 1, type: 'turn.completed', seq: 2, ts: 123 })
	})

	it('синтез message.completed: конкатенация чанков, порядок до turn.completed, сброс между ходами', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const events: { type: string; text?: string }[] = []
		a.subscribe(id, { onEvent: e => events.push({ type: e.type, text: (e.data as { text?: string }).text }) })
		// первый ход: много-chunk стрим, затем завершение
		g.emitNative({ kind: 'text', text: 'часть', messageId: 'm1' }, 1)
		g.emitNative({ kind: 'text', text: '1-', messageId: 'm1' }, 2)
		g.emitNative({ kind: 'text', text: 'два', messageId: 'm1' }, 3)
		g.emitNative({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }, 4)
		const mc = events.find(e => e.type === 'message.completed')
		// текст склеен из всех чанков хода
		assert.equal(mc?.text, 'часть1-два')
		// message.completed приходит строго до turn.completed
		const mcIdx = events.findIndex(e => e.type === 'message.completed')
		const tcIdx = events.findIndex(e => e.type === 'turn.completed')
		assert.ok(mcIdx !== -1 && mcIdx < tcIdx, `message.completed должен быть до turn.completed: ${events.map(e => e.type).join(', ')}`)
		// второй ход: накопленный текст предыдущего хода сброшен, не дублируется
		events.length = 0
		g.emitNative({ kind: 'text', text: 'новый', messageId: 'm1' }, 5)
		g.emitNative({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }, 6)
		const mc2 = events.find(e => e.type === 'message.completed')
		assert.equal(mc2?.text, 'новый')
	})

	it('sessionClose синтезирует session.closed и пробрасывает closeSession', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const types: string[] = []
		a.subscribe(id, { onEvent: e => types.push(e.type) })
		await a.sessionClose(id)
		assert.ok(types.includes('session.closed'))
		assert.deepEqual(g.calls.filter(c => c.startsWith('close')), [`close:${id}`])
	})

	it('modelSet отклоняется (setModel=false)', async () => {
		await assert.rejects(() => adapter(new FakeGateway()).modelSet('s', 'm'), (e: unknown) => e instanceof AppError && e.code === 'model_not_supported')
	})

	it('permissionVote и midTurnSend пробрасываются', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		await a.permissionVote('s', 'r', 'opt')
		await a.midTurnSend('s', 'msg')
		assert.ok(g.calls.includes('vote:s:r:opt'))
		assert.ok(g.calls.includes('midTurn:s'))
	})

	it('midTurnSend=false пробрасывается без ошибки (сессия простаивает/очередь полна)', async () => {
		const g = new FakeGateway()
		g.midTurnResult = false
		const a = adapter(g)
		assert.equal(await a.midTurnSend('s', 'msg'), false)
		assert.ok(g.calls.includes('midTurn:s'))
	})

	it('закрытие подписки: sub.close() и очистка подписчика — события после close не доставляются', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const types: string[] = []
		const sub = a.subscribe(id, { onEvent: e => types.push(e.type) })
		sub.close()
		g.emitNative({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }, 3)
		assert.ok(g.subClosed, 'клиентская подписка должна быть закрыта')
		assert.ok(!types.includes('turn.completed'), 'после close события не должны доставляться')
	})

	it('операция на незарегистрированной сессии создаёт состояние синтеза (ensureSession)', () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const types: string[] = []
		a.subscribe('unknown-session', { onEvent: e => types.push(e.type) })
		// сессия не создавалась через sessionCreate — адаптер создаёт синтез, ready=true, шлёт session.ready
		assert.ok(types.includes('session.ready'))
		g.emitNative({ kind: 'text', text: 'текст', messageId: 'm1' }, 3)
		g.emitNative({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }, 4)
		assert.ok(types.includes('message.delta'))
		assert.ok(types.includes('message.completed'))
		assert.ok(types.includes('turn.completed'))
	})

	it('ошибка постановки промпта → turn.failed, без turn.started (парность не нарушается)', async () => {
		const g = new FakeGateway()
		g.promptError = new AppError(503, 'unavailable', 'nessy недоступен')
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const types: string[] = []
		a.subscribe(id, { onEvent: e => types.push(e.type) })
		await assert.rejects(() => a.promptSend(id, 'привет'))
		assert.ok(types.includes('turn.failed'), `ожидали turn.failed: ${types.join(', ')}`)
		assert.ok(!types.includes('turn.started'), 'не должно быть висячего turn.started')
	})

	it('seq монотонен и уникален для синтезированных и нативных событий в одном потоке', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const seqs: number[] = []
		a.subscribe(id, { onEvent: e => seqs.push(e.seq!) })
		await a.promptSend(id, 'привет') // session.ready(1), turn.started(2)
		g.emitNative({ kind: 'text', text: 'a', messageId: 'm1' }, 10) // seq 3
		g.emitNative({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }, 11) // message.completed(4), turn.completed(5)
		assert.ok(seqs.length >= 5, `мало событий: ${seqs.join(', ')}`)
		for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i]! > seqs[i - 1]!, `seq не монотонен: ${seqs.join(', ')}`)
	})

	it('обрыв транспорта (died) посреди хода → turn.failed + error (не зависаем)', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const types: string[] = []
		a.subscribe(id, { onEvent: e => types.push(e.type) })
		await a.promptSend(id, 'привет') // turn.started, ход открыт
		g.emitNative({ kind: 'died', reason: 'crash' }, 20)
		assert.ok(types.includes('turn.failed'), `ожидали turn.failed: ${types.join(', ')}`)
		assert.ok(types.includes('error'))
	})

	it('sessionClose с открытым ходом → turn.cancelled + session.closed (парность)', async () => {
		const g = new FakeGateway()
		const a = adapter(g)
		const id = (await a.sessionCreate()).sessionId
		const types: string[] = []
		a.subscribe(id, { onEvent: e => types.push(e.type) })
		await a.promptSend(id, 'привет') // ход открыт
		await a.sessionClose(id)
		assert.ok(types.includes('turn.cancelled'), `ожидали turn.cancelled: ${types.join(', ')}`)
		assert.ok(types.includes('session.closed'))
	})
})