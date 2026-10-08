import assert from 'node:assert/strict'
import * as http from 'node:http'
import { after, before, describe, it } from 'node:test'
import type {
	AgentView,
	GraphView,
	InboxResponse,
	Message,
	SendResponse,
	SpawnResponse,
} from '../shared/types'
import { startHarness, until, type Harness } from './helpers'

describe('оркестратор + фейковый nessy', () => {
	let h: Harness
	before(async () => {
		h = await startHarness()
		const r = await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
		assert.equal(r.status, 201)
	})
	after(async () => {
		await h.close()
	})

	const msgs = (): Message[] => h.orch.listMessages({ limit: 1000 })

	it('spawn --wait возвращает ответ агента и пишет сообщения в ленту', async () => {
		const r = await h.api<SpawnResponse>('POST', '/agents', {
			space: 'main',
			name: 'alpha',
			prompt: 'привет мир',
			wait: true,
		})
		assert.equal(r.status, 201)
		assert.equal(r.body.reply?.text, 'ответ: привет мир')
		assert.equal(r.body.agent.name, 'alpha')
		const kinds = msgs()
			.filter(m => m.from === 'you' || m.to === 'you')
			.map(m => `${m.from}>${m.to}:${m.kind}`)
		assert.ok(kinds.includes(`you>${r.body.agent.id}:msg`))
		assert.ok(kinds.includes(`${r.body.agent.id}>you:reply`))
	})

	it('агенты изолированы: у каждого своя сессия', async () => {
		const a = h.orch.resolveAgent('alpha')
		const r = await h.api<SpawnResponse>('POST', '/agents', {
			space: 'main',
			name: 'beta',
			prompt: 'второй',
			wait: true,
		})
		const b = h.orch.resolveAgent(r.body.agent.id)
		assert.notEqual(a.sessionId, b.sessionId)
		assert.equal(r.body.reply?.text, 'ответ: второй')
	})

	it('send без wait → ответ приходит в inbox, курсор сдвигается', async () => {
		await h.api('GET', '/inbox') // сбросить накопленное
		const s = await h.api<SendResponse>('POST', '/agents/alpha/send', {
			text: 'асинхронно',
		})
		assert.equal(s.status, 200)
		assert.equal(s.body.reply, undefined)
		const inbox = await h.api<InboxResponse>('GET', '/inbox?wait=5')
		assert.equal(inbox.body.messages.length, 1)
		assert.equal(inbox.body.messages[0]?.text, 'ответ: асинхронно')
		const again = await h.api<InboxResponse>('GET', '/inbox')
		assert.equal(again.body.messages.length, 0)
	})

	it('очередь: сообщения агенту обрабатываются по порядку, авторство сохраняется', async () => {
		await h.api('POST', '/agents/beta/send', { text: 'один' })
		await h.api('POST', '/agents/beta/send', { text: 'два' })
		await h.api('POST', '/agents/beta/send', { text: 'три' })
		await until(
			() =>
				msgs().filter(
					m => m.kind === 'reply' && /ответ: (один|два|три)/.test(m.text),
				).length === 3,
			8000,
			'три ответа',
		)
		const replies = msgs()
			.filter(m => m.kind === 'reply' && /ответ: (один|два|три)/.test(m.text))
			.map(m => m.text)
		assert.deepEqual(replies, ['ответ: один', 'ответ: два', 'ответ: три'])
	})

	it('агент → агент: relay через CLI, ответ возвращается отправителю', async () => {
		// alpha через shell вызывает `send --from alpha --wait beta "вопрос"` — это эмулирует реального агента
		const r = await h.api<SendResponse>('POST', '/agents/alpha/send', {
			text: '#relay --from alpha --wait beta вопрос-от-альфы',
			wait: true,
			waitTimeoutSec: 20,
		})
		assert.ok(r.body.reply, 'alpha должен ответить')
		const a = h.orch.resolveAgent('alpha').id
		const b = h.orch.resolveAgent('beta').id
		const direct = msgs().find(
			m => m.from === a && m.to === b && m.kind === 'msg',
		)
		assert.ok(direct, 'сообщение alpha→beta есть в ленте')
		const back = msgs().find(
			m =>
				m.from === b &&
				m.to === a &&
				m.kind === 'reply' &&
				m.replyTo === direct.id,
		)
		assert.ok(back, 'ответ beta→alpha есть в ленте')
		assert.equal(back.text, 'ответ: вопрос-от-альфы')
	})

	it('hop limit останавливает зацикливание', async () => {
		const a = h.orch.resolveAgent('alpha')
		const b = h.orch.resolveAgent('beta')
		assert.throws(
			() =>
				h.orch.post({ from: a.id, to: b.id, kind: 'msg', text: 'x', hops: 99 }),
			/зацикливани/,
		)
	})

	it('взаимное ожидание (deadlock) отклоняется', async () => {
		const a = h.orch.resolveAgent('alpha').id
		const b = h.orch.resolveAgent('beta').id
		const slow = h.api<SendResponse>('POST', `/agents/${b}/send`, {
			from: a,
			text: '#slow',
			wait: true,
			waitTimeoutSec: 10,
		})
		await until(
			() => msgs().some(m => m.from === a && m.to === b && m.text === '#slow'),
			3000,
			'alpha→beta в ленте',
		)
		const bad = await h.api<{ code: string }>('POST', `/agents/${a}/send`, {
			from: b,
			text: 'встречный',
			wait: true,
		})
		assert.equal(bad.status, 409)
		assert.equal(bad.body.code, 'deadlock')
		await slow
	})

	it('cancel прерывает ход', async () => {
		const gamma = await h.api<SpawnResponse>('POST', '/agents', {
			space: 'main',
			name: 'gamma',
		})
		await h.api('POST', '/agents/gamma/send', { text: '#slow' })
		await until(
			() => h.orch.resolveAgent('gamma').status === 'working',
			4000,
			'gamma working',
		)
		const c = await h.api<AgentView>('POST', '/agents/gamma/cancel', {})
		assert.equal(c.status, 200)
		await until(
			() => h.orch.resolveAgent('gamma').status === 'idle',
			6000,
			'gamma idle',
		)
		assert.ok(gamma.body.agent.id)
	})

	it('падение сессии nessy переводит агента в dead и сообщает отправителю', async () => {
		await h.api('POST', '/agents', { space: 'main', name: 'doomed' })
		const r = await h.api<SendResponse>('POST', '/agents/doomed/send', {
			text: '#fail',
			wait: true,
			waitTimeoutSec: 8,
		})
		assert.ok(r.body.reply?.failed, 'ответ помечен ошибкой')
		assert.equal(h.orch.resolveAgent('doomed').status, 'dead')
		const again = await h.api<SendResponse>('POST', '/agents/doomed/send', {
			text: 'ещё',
		})
		assert.equal(again.status, 200) // сообщение принято, но не доставлено — видно в ленте
		assert.ok(
			msgs().some(m => m.kind === 'event' && /не доставлено/.test(m.text)),
		)
	})

	it('/graph и /status согласованы', async () => {
		const g = await h.api<GraphView>('GET', '/graph')
		assert.ok(g.body.agents.length >= 4)
		assert.equal(g.body.spaces[0]?.status, 'ready')
	})

	it('API защищён от чужого Host/Origin', async () => {
		const evil = await new Promise<number>(resolve => {
			http
				.request(
					{
						host: '127.0.0.1',
						port: h.port,
						path: '/graph',
						headers: { Host: 'evil.example' },
					},
					res => {
						res.resume()
						resolve(res.statusCode ?? 0)
					},
				)
				.end()
		})
		assert.equal(evil, 403)
	})
})
