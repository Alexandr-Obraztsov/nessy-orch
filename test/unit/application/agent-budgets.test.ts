/** Бюджеты порождения (глубина, число агентов), автоудаление завершённых и ответ удалённому отправителю. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import type { SessionView } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import type { OrchSettings } from '../../../src/application/settings.types'
import { AppError } from '../../../src/domain/errors'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

function setup(extra: Partial<OrchSettings> = {}) {
	const gw = new FakeGateway()
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0, ...extra },
		store: new MemoryStore(),
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const session: SessionView = orch.createSession({ title: 'Бюджеты' })
	return { orch, gw, session }
}
const code = async (fn: () => Promise<unknown>): Promise<string> => {
	try {
		await fn()
	} catch (e) {
		return e instanceof AppError ? `${e.status} ${e.code}` : 'other'
	}
	return 'ok'
}

describe('бюджеты порождения', () => {
	it('глубина: агент оператора — 0, запущенный им — 1, на уровне maxDepth ещё можно, глубже — 429 depth_exceeded', async () => {
		const { orch, session } = setup({ maxDepth: 2 })
		const a = (await orch.spawn({ space: 'main', name: 'a', session: session.id })).agent.id
		const b = (await orch.spawn({ space: 'main', name: 'b', session: session.id, from: a })).agent.id
		const c = (await orch.spawn({ space: 'main', name: 'c', session: session.id, from: b })).agent.id
		assert.equal(await code(() => orch.spawn({ space: 'main', name: 'd', session: session.id, from: c })), '429 depth_exceeded')
		assert.equal(orch.getAgent(c).parent, b)
	})

	it('число одновременно работающих агентов в сессии ограничено; завершённые не считаются', async () => {
		const { orch, gw, session } = setup({ maxActivePerSession: 2 })
		await orch.spawn({ space: 'main', name: 'w1', session: session.id, prompt: 'работай' })
		await orch.spawn({ space: 'main', name: 'w2', session: session.id, prompt: 'работай' })
		await until(() => gw.prompts.length === 2, 2000, 'оба работают')
		assert.equal(await code(() => orch.spawn({ space: 'main', name: 'w3', session: session.id })), '429 too_many_active')
		gw.emit({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-2' })
		await until(() => !orch.getAgent('w1').queued && orch.getAgent('w1').status === 'idle' && orch.getAgent('w2').status === 'idle', 2000, 'оба свободны')
		assert.equal(await code(() => orch.spawn({ space: 'main', name: 'w3', session: session.id })), 'ok')
	})

	it('общее число агентов в сессии ограничено (подсказка — kill или переиспользовать)', async () => {
		const { orch, session } = setup({ maxAgentsPerSession: 2 })
		await orch.spawn({ space: 'main', name: 'x1', session: session.id })
		await orch.spawn({ space: 'main', name: 'x2', session: session.id })
		assert.equal(await code(() => orch.spawn({ space: 'main', name: 'x3', session: session.id })), '429 too_many_agents')
		await orch.removeAgent('x1')
		assert.equal(await code(() => orch.spawn({ space: 'main', name: 'x3', session: session.id })), 'ok')
	})

	it('автоудаление: завершённых (архивных) агентов, которым давно не писали, удаляет сборщик; занятых и свежих — нет', async () => {
		const { orch, session } = setup({ agentTtlMs: 1000 })
		const old = (await orch.spawn({ space: 'main', name: 'old', session: session.id })).agent.id
		const fresh = (await orch.spawn({ space: 'main', name: 'fresh', session: session.id })).agent.id
		orch.archiveAgent(old)
		orch.archiveAgent(fresh)
		assert.equal(await orch.collectGarbage(), 0, 'свежие не трогаем')
		assert.equal(await orch.collectGarbage(Date.now() + 5000), 2, 'через ttl — оба удалены')
		assert.equal(orch.listAgents().length, 0)
	})
})

describe('ответ удалённому отправителю', () => {
	it('агент удалён, пока другой работал над его сообщением: ответ уходит оператору с пометкой, а не в пустоту', async () => {
		const { orch, gw, session } = setup()
		const asker = (await orch.spawn({ space: 'main', name: 'asker', session: session.id })).agent.id
		const worker = (await orch.spawn({ space: 'main', name: 'worker', session: session.id })).agent.id
		await orch.send(worker, { from: asker, text: 'вопрос' })
		await until(() => gw.prompts.length === 1, 2000, 'worker работает')
		await orch.removeAgent(asker)
		gw.emit({ kind: 'text', text: 'ответ', messageId: 'm1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		await until(() => orch.listMessages().some(m => m.kind === 'reply' && m.to === 'you' && /удалённого агента/.test(m.text)), 2000, 'ответ оператору')
	})
})

describe('сообщения человека из приложения (отправитель user)', () => {
	it('агент отвечает человеку; главный агент сессии получает служебную запись о сообщении и копию ответа в свой inbox', async () => {
		const { orch, gw, session } = setup()
		const id = (await orch.spawn({ space: 'main', name: 'helper', session: session.id })).agent.id
		await orch.send(id, { from: 'user', text: 'как дела?' })
		await until(() => gw.prompts.length === 1, 2000, 'агент получил сообщение')
		const notice = (await orch.inbox({ session: session.id, peek: true })).messages
		assert.equal(notice.length, 1)
		assert.match(notice[0]?.text ?? '', /пользователь написал агенту helper.*как дела\?/s)
		gw.emit({ kind: 'text', text: 'нормально', messageId: 'm1' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		await until(() => orch.listMessages().some(m => m.kind === 'reply' && m.to === 'user' && m.text === 'нормально'), 2000, 'ответ человеку')
		const inbox = (await orch.inbox({ session: session.id })).messages
		assert.equal(inbox.length, 2, 'служебная запись и копия ответа')
		assert.match(inbox[1]?.text ?? '', /ответ пользователю.*нормально/s)
		assert.equal(orch.getAgent(id).lastReply?.preview, 'нормально', 'карточка агента показывает ответ')
		assert.equal(orch.listMessages().filter(m => m.to === 'user').length, 1)
	})
})

describe('ядро: удаление, откат и потерянные пространства', () => {
	it('удаление работающего агента: ждавший его ответа получает «(ход прерван)», а не таймаут', async () => {
		const { orch, gw } = setup()
		const id = (await orch.spawn({ space: 'main', name: 'doomed', prompt: 'работай' })).agent.id
		await until(() => gw.prompts.length === 1, 2000, 'работает')
		const waiting = orch.send(id, { text: 'жду ответ', wait: true, waitTimeoutSec: 30, from: 'you' })
		await until(() => orch.getAgent(id).queued === 1, 1000, 'сообщение ждёт в очереди')
		await orch.removeAgent(id)
		const r = await waiting
		assert.ok(r.reply, 'ответ получен сразу, без таймаута')
		assert.match(r.reply.text, /\(ход прерван\)$/)
		assert.equal(r.reply.failed, undefined)
	})

	it('spawn: поручение отклонено (лимит цепочки) — агент без поручения не остаётся', async () => {
		const { orch, session } = setup({ maxHops: 0 })
		const parent = (await orch.spawn({ space: 'main', name: 'parent', session: session.id })).agent.id
		assert.equal(await code(() => orch.spawn({ space: 'main', name: 'child', session: session.id, from: parent, prompt: 'сделай' })), '429 hop_limit')
		assert.equal(orch.listAgents().some(a => a.name === 'child'), false)
	})

	it('рестарт: агент, чьё пространство пропало из состояния, не теряется — остаётся с ошибкой и причиной', async () => {
		const store = new MemoryStore()
		const gw = new FakeGateway()
		const make = () =>
			new Orchestrator({
				settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch', idleCloseMs: 0 },
				store,
				spaceFactory: init => new FakeSpace(init.name, init.path, gw),
			})
		const first = make()
		first.addSpace({ path: os.tmpdir(), name: 'main' })
		await first.spawn({ space: 'main', name: 'keeper' })
		await first.shutdown()
		store.state.spaces = []
		const next = make()
		next.load()
		const a = next.getAgent('keeper')
		assert.equal(a.status, 'error')
		assert.match(a.error ?? '', /не найдено/)
		await next.shutdown()
	})
})
