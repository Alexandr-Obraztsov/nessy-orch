/**
 * Unit-тесты правок волны A адаптера NessySdkAgentPort: §6б-резюм из closed-registry, гейт закрытия (нет
 * двойного терминала), busy-guard, abort/subscriber/permissionVote, usage-size. Вынесено из основного
 * test-файла, чтобы оба укладывались в max-lines.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import type { SDKMessage } from '@nestor/nessy-cli-sdk'
import { assistantMsg, deltaMsg, defaultRespond, makePort, sdkMsg, waitFor } from './sdk-test-support'

describe('NessySdkAgentPort (волна A)', () => {
	it('§6б резюм: close→resume→promptSend спавнит query с resume:sessionId, seq продолжается, session.ready снова', async () => {
		const { port, resumeFlag } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const types1: string[] = []
		const seqs: number[] = []
		port.subscribe(id, { onEvent: e => (types1.push(e.type), seqs.push(e.seq)) })
		await port.promptSend(id, 'первый')
		await waitFor(types1, 'turn.completed')
		const lastSeqBefore = seqs.at(-1) ?? 0
		await port.sessionClose(id)
		const r = await port.sessionResume(id, '/ws')
		assert.deepEqual(r, { lastSeq: lastSeqBefore }, 'резюм закрытой сессии возвращает спецификацию восстановления')
		assert.equal(resumeFlag(), undefined, 'до нового промпта новый query ещё не спавнен')
		// ядро переподписывается на поднятой сессии: готовность синтезируется на подписке
		const types2: string[] = []
		port.subscribe(id, { onEvent: e => (types2.push(e.type), seqs.push(e.seq)) })
		assert.ok(types2.includes('session.ready'), 'после resume сессия снова готова (на подписке)')
		await port.promptSend(id, 'снова')
		assert.equal(resumeFlag(), id, 'новый query спавнится с resume:sessionId (контекст поднимается)')
		await waitFor(types2, 'turn.completed')
		assert.ok((seqs.at(-1) ?? 0) > lastSeqBefore, `seq продолжается от lastSeq: ${lastSeqBefore} → ${seqs.at(-1)}`)
	})

	it('sessionClose при открытом ходе → ровно turn.cancelled + session.closed (без turn.completed/usage)', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const types: string[] = []
		port.subscribe(id, { onEvent: e => types.push(e.type) })
		await port.promptSend(id, '#slow')
		await waitFor(types, 'turn.started')
		await port.sessionClose(id)
		await waitFor(types, 'session.closed')
		await new Promise(r => setTimeout(r, 50)) // дать время позднему result прийти
		assert.ok(types.includes('turn.cancelled'))
		assert.ok(!types.includes('turn.completed'), 'не должно быть turn.completed после cancelled+closed')
		assert.ok(!types.includes('context.usage'), 'не должно быть context.usage после cancelled+closed')
		assert.equal(types.filter(t => t === 'turn.cancelled').length, 1, 'ровно один cancelled')
		assert.equal(types.filter(t => t === 'session.closed').length, 1, 'ровно один closed')
	})

	it('параллельный promptSend отклоняется (session_busy)', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const types: string[] = []
		port.subscribe(id, { onEvent: e => types.push(e.type) })
		await port.promptSend(id, '#slow') // открытый ход
		await waitFor(types, 'turn.started')
		await assert.rejects(
			() => port.promptSend(id, 'второй'),
			(e: unknown) => e instanceof AppError && e.code === 'session_busy',
		)
	})

	it('abortController abort() при close', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const q = lastQuery()
		assert.equal(q.aborted(), false)
		await port.sessionClose(id)
		assert.equal(q.aborted(), true, 'close должен abort-ить SDK-контроллер')
	})

	it('abortController abort() при forceClose (promptCancel/exit130)', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const types: string[] = []
		port.subscribe(id, { onEvent: e => types.push(e.type) })
		await port.promptSend(id, '#slow')
		await waitFor(types, 'turn.started')
		await port.promptCancel(id)
		assert.equal(lastQuery().aborted(), true, 'forceClose должен abort-ить SDK-контроллер')
	})

	it('исключение подписчика не убивает сессию (emit защищён)', async () => {
		const { port } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const received: string[] = []
		let thrown = false
		port.subscribe(id, {
			onEvent: e => {
				if (!thrown) {
					thrown = true
					throw new Error('boom')
				}
				received.push(e.type)
			},
		})
		await port.promptSend(id, 'тест')
		await waitFor(received, 'turn.completed')
		assert.ok(received.includes('turn.completed'), 'ход завершился, несмотря на исключение подписчика')
	})

	it('permissionVote строгий: невалидная опция → deny, заявленная allow → allow, null → deny', async () => {
		const { port, lastQuery } = makePort(defaultRespond)
		const id = (await port.sessionCreate()).sessionId
		const events: { type: string; data?: unknown }[] = []
		port.subscribe(id, { onEvent: e => events.push({ type: e.type, data: e.data }) })
		const q = lastQuery()
		const p1 = q.canUseTool('write_file', {})
		const r1 = events.find(e => e.type === 'permission.requested')?.data as { requestId: string }
		assert.ok(r1, 'ожидали permission.requested')
		await port.permissionVote(id, r1.requestId, 'banana')
		assert.equal((await p1).behavior, 'deny', 'невалидная опция → deny')
		const p2 = q.canUseTool('write_file', {})
		const r2 = (events.filter(e => e.type === 'permission.requested').pop() as { data: { requestId: string } }).data
		await port.permissionVote(id, r2.requestId, 'allow')
		assert.equal((await p2).behavior, 'allow', 'заявленная allow → allow')
		const p3 = q.canUseTool('write_file', {})
		const r3 = (events.filter(e => e.type === 'permission.requested').pop() as { data: { requestId: string } }).data
		await port.permissionVote(id, r3.requestId, null)
		assert.equal((await p3).behavior, 'deny', 'null → deny')
	})

	it('context.usage.size берётся из modelUsage.contextWindow, если он доступен', async () => {
		const resultWithModelUsage = (window: number): SDKMessage =>
			sdkMsg({
				type: 'result',
				subtype: 'success',
				uuid: 'u',
				session_id: 's',
				is_error: false,
				duration_ms: 10,
				duration_api_ms: 9,
				num_turns: 1,
				result: 'ok',
				usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
				permission_denials: [],
				modelUsage: {
					m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, contextWindow: window },
				},
			})
		const { port } = makePort(() => [deltaMsg('x'), assistantMsg('x'), resultWithModelUsage(200000)])
		const id = (await port.sessionCreate()).sessionId
		const types: string[] = []
		const usageData: unknown[] = []
		port.subscribe(id, { onEvent: e => (types.push(e.type), e.type === 'context.usage' ? usageData.push(e.data) : undefined) })
		await port.promptSend(id, 'тест')
		await waitFor(types, 'context.usage')
		assert.equal((usageData[0] as { used: number; size: number }).used, 5)
		assert.equal((usageData[0] as { used: number; size: number }).size, 200000, 'size из modelUsage.contextWindow')
	})
})
