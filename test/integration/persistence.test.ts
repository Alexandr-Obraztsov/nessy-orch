/** Рестарт оркестратора: состояние, лента, история и очередь восстанавливаются из home. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import type { InboxResponse, SendResponse, SpawnResponse, UserEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 30000 }

describe('рестарт и восстановление', () => {
	let first: Harness | null = null
	let second: Harness | null = null
	after(async () => {
		await first?.close({ keepFiles: true })
		await second?.close()
	})

	it('после shutdown состояние читается заново; агенты спят и поднимаются по первому сообщению', T, async () => {
		first = await startHarness()
		await first.api('POST', '/spaces', { path: first.ws, name: 'main' })
		const sp = await first.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'keeper', prompt: 'запомни', wait: true })
		const id = sp.body.agent.id
		const sessionBefore = first.orch.resolveAgent(id).sessionId
		await first.api('POST', '/agents', { space: 'main', name: 'doomed', prompt: '#fail', wait: true, waitTimeoutSec: 8 })
		await first.api('GET', '/inbox') // сдвинуть курсор
		const seqBefore = first.orch.listMessages({ limit: 1000 }).at(-1)?.seq ?? 0
		const base = first.base
		await first.close({ keepFiles: true })
		first = null

		const state: unknown = JSON.parse(fs.readFileSync(path.join(base, 'home', 'state.json'), 'utf8'))
		assert.ok(typeof state === 'object' && state !== null && 'agents' in state)

		second = await startHarness({ base })
		const keeper = second.orch.getAgent('keeper')
		assert.equal(keeper.id, id)
		assert.equal(keeper.status, 'idle')
		assert.equal(keeper.archived, true, 'архив переживает рестарт')
		assert.equal(keeper.preview, 'ответ: запомни')
		const doomed = second.orch.getAgent('doomed')
		assert.equal(doomed.status, 'idle', 'после рестарта упавший агент снова принимает сообщения')
		assert.equal(doomed.archived, false)
		assert.equal(second.orch.graph().spaces[0]?.name, 'main')
		assert.equal(second.orch.listMessages({ limit: 1000 }).at(-1)?.seq, seqBefore)
		assert.ok(second.orch.agentHistory('keeper').some(e => e.kind === 'text' && e.text === 'ответ: запомни'))
		assert.deepEqual((await second.api<InboxResponse>('GET', '/inbox?peek=1')).body.messages, [], 'курсор inbox сохранён')

		// serve новый — старой сессии в нём нет: создаётся новая с пометкой о сбросе контекста
		const r = await second.api<SendResponse>('POST', '/agents/keeper/send', { text: 'снова', wait: true, waitTimeoutSec: 10 })
		assert.equal(r.body.reply?.text, 'ответ: снова')
		assert.ok(r.body.message.seq > seqBefore, 'нумерация ленты продолжается')
		assert.notEqual(second.orch.resolveAgent(id).sessionId, sessionBefore)
		assert.ok(second.orch.agentHistory('keeper').some(e => e.kind === 'system' && /не удалось восстановить.*контекст сброшен/.test(e.text)))
		assert.equal(second.orch.getAgent('keeper').archived, true, 'снова в архиве после успешного хода')
		const seqs = second.orch.agentHistory('keeper', 1000).map(e => e.seq)
		assert.equal(new Set(seqs).size, seqs.length, 'seq событий не повторяются после рестарта')
	})

	it('очередь переживает рестарт', T, async () => {
		const h = second
		assert.ok(h)
		await h.api('POST', '/agents/keeper/send', { text: '#slow' })
		await until(() => h.orch.getAgent('keeper').status === 'working', 4000, 'working')
		await h.api('POST', '/agents/keeper/send', { text: 'отложенное' })
		const base = h.base
		await h.close({ keepFiles: true })
		second = await startHarness({ base })
		const h2 = second
		// очередь доставляется сразу после загрузки состояния
		await until(
			() => h2.orch.listMessages({ agent: 'keeper', limit: 1000 }).some(m => m.kind === 'reply' && m.text === 'ответ: отложенное'),
			10000,
			'ответ на отложенное',
		)
		assert.equal(h2.orch.getAgent('keeper').queued, 0)
		const r = await second.api<SendResponse>('POST', '/agents/keeper/send', { text: 'после рестарта', wait: true, waitTimeoutSec: 10 })
		assert.equal(r.body.reply?.text, 'ответ: после рестарта')
		const users = second.orch
			.agentHistory('keeper', 1000)
			.filter((e): e is UserEvent => e.kind === 'user')
			.map(e => e.text)
		assert.deepEqual(users.slice(-2), ['отложенное', 'после рестарта'])
	})
})
