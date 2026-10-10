/** Сообщения: spawn --wait, send/reply, inbox, очередь, межагентная переписка и защиты. */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { ApiError, InboxResponse, Message, SendResponse, SpawnResponse, UserEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 25000 }

describe('сообщения и маршрутизация', () => {
	let h: Harness
	let alpha = ''
	let beta = ''
	const msgs = (): Message[] => h.orch.listMessages({ limit: 1000 })

	before(async () => {
		h = await startHarness()
		assert.equal((await h.api('POST', '/spaces', { path: h.ws, name: 'main' })).status, 201)
	})
	after(() => h.close())

	it('spawn --wait возвращает ответ агента и пишет сообщения в ленту', T, async () => {
		const r = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'alpha', prompt: 'привет мир', wait: true })
		assert.equal(r.status, 201)
		alpha = r.body.agent.id
		assert.equal(r.body.reply?.text, 'ответ: привет мир')
		assert.equal(r.body.reply.replyTo, r.body.message.id)
		assert.equal(r.body.agent.name, 'alpha')
		const kinds = msgs().map(m => `${m.from}>${m.to}:${m.kind}`)
		assert.ok(kinds.includes(`you>${alpha}:msg`))
		assert.ok(kinds.includes(`${alpha}>you:reply`))
		assert.ok(msgs().some(m => m.kind === 'event' && /создал агента/.test(m.text)))
		assert.equal(h.orch.getAgent('alpha').displayName, 'привет мир')
		assert.equal(h.orch.getAgent('alpha').status, 'idle')
	})

	it('агенты изолированы: у каждого своя сессия; имена уникальны', T, async () => {
		const r = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'beta', prompt: 'второй', wait: true })
		beta = r.body.agent.id
		assert.notEqual(h.orch.resolveAgent(alpha).nessyId, h.orch.resolveAgent(beta).nessyId)
		assert.equal(r.body.reply?.text, 'ответ: второй')
		const dup = await h.api<ApiError>('POST', '/agents', { space: 'main', name: 'BETA' })
		assert.equal(dup.status, 409)
		assert.equal(dup.body.code, 'name_taken')
	})

	it('первый промпт содержит вводную, следующие — нет', T, () => {
		const ev = h.orch.agentHistory(alpha)
		assert.equal(ev.filter(e => e.kind === 'user').length >= 1, true)
		assert.equal(h.orch.resolveAgent(alpha).introduced, true)
	})

	it('send без wait → ответ в inbox, курсор сдвигается; peek не двигает', T, async () => {
		await h.api('GET', '/inbox') // сбросить накопленное
		const s = await h.api<SendResponse>('POST', '/agents/alpha/send', { text: 'асинхронно' })
		assert.equal(s.status, 200)
		assert.equal(s.body.reply, undefined)
		const peek = await h.api<InboxResponse>('GET', '/inbox?wait=5&peek=1')
		assert.equal(peek.body.messages[0]?.text, 'ответ: асинхронно')
		const inbox = await h.api<InboxResponse>('GET', '/inbox')
		assert.equal(inbox.body.messages.length, 1)
		assert.equal((await h.api<InboxResponse>('GET', '/inbox')).body.messages.length, 0)
		const afterCursor = await h.api<InboxResponse>('GET', `/inbox?after=0`)
		assert.ok(afterCursor.body.messages.length >= 1, 'after=N читает историю, не трогая курсор')
	})

	it('long-poll inbox возвращается по таймауту пустым', T, async () => {
		const t0 = Date.now()
		const r = await h.api<InboxResponse>('GET', '/inbox?wait=1')
		assert.equal(r.body.messages.length, 0)
		assert.ok(Date.now() - t0 >= 900)
	})

	it('очередь (interrupt:false): пока агент работает, сообщения ждут и обрабатываются по порядку', T, async () => {
		await h.api('POST', '/agents/beta/send', { text: '#slow' })
		await until(() => h.orch.getAgent('beta').status === 'working', 4000, 'beta working')
		for (const t of ['один', 'два', 'три']) await h.api('POST', '/agents/beta/send', { text: t, interrupt: false })
		assert.equal(h.orch.getAgent('beta').queued, 3)
		const isOurs = (m: Message): boolean => m.kind === 'reply' && m.from === beta && /^(ответ: (один|два|три)|медленный ответ)$/.test(m.text)
		await until(() => msgs().filter(isOurs).length === 4, 10000, 'четыре ответа')
		assert.deepEqual(
			msgs()
				.filter(isOurs)
				.map(m => m.text),
			['медленный ответ', 'ответ: один', 'ответ: два', 'ответ: три'],
		)
		const users = h.orch
			.agentHistory(beta)
			.filter((e): e is UserEvent => e.kind === 'user')
			.map(e => e.text)
			.slice(-4)
		assert.deepEqual(users, ['#slow', 'один', 'два', 'три'])
		assert.equal(h.orch.getAgent('beta').queued, 0)
	})

	it('/messages фильтрует по агенту и since', T, async () => {
		const all = (await h.api<Message[]>('GET', '/messages?limit=1000')).body
		const onlyAlpha = (await h.api<Message[]>('GET', '/messages?agent=alpha&limit=1000')).body
		assert.ok(onlyAlpha.length > 0 && onlyAlpha.length < all.length)
		assert.ok(onlyAlpha.every(m => m.from === alpha || m.to === alpha))
		const last = all[all.length - 1] as Message
		assert.deepEqual((await h.api<Message[]>('GET', `/messages?since=${last.seq}`)).body, [])
	})

	it('агент → агент: relay через CLI с --wait, ответ возвращается в вызов и не дублируется промптом', T, async () => {
		const r = await h.api<SendResponse>('POST', '/agents/alpha/send', {
			text: '#relay --from alpha --wait beta вопрос-от-альфы',
			wait: true,
			waitTimeoutSec: 20,
		})
		assert.ok(r.body.reply, 'alpha должен ответить')
		assert.match(r.body.reply.text, /выполнено: ответ: вопрос-от-альфы/)
		const direct = msgs().find(m => m.from === alpha && m.to === beta && m.kind === 'msg')
		assert.ok(direct, 'сообщение alpha→beta есть в ленте')
		assert.equal(direct.hops, 1)
		assert.equal(direct.wait, true)
		const back = msgs().find(m => m.from === beta && m.to === alpha && m.kind === 'reply' && m.replyTo === direct.id)
		assert.ok(back, 'ответ beta→alpha есть в ленте')
		assert.equal(back.text, 'ответ: вопрос-от-альфы')
		assert.equal(back.hops, 2)
		const alphaUsers = h.orch.agentHistory(alpha).filter(e => e.kind === 'user' && /ответ агента/.test(e.text))
		assert.equal(alphaUsers.length, 0, 'ответ ожидающему не приходит промптом')
	})

	it('агент → агент без wait: ответ приходит отправителю промптом, ответ на ответ не порождается', T, async () => {
		const before = msgs().length
		const r = await h.api<SendResponse>('POST', `/agents/${beta}/send`, { from: alpha, text: 'асинхронный вопрос' })
		assert.equal(r.status, 200)
		await until(
			() => h.orch.agentHistory(alpha).some(e => e.kind === 'user' && e.text === 'ответ: асинхронный вопрос'),
			8000,
			'ответ beta пришёл alpha промптом',
		)
		await until(() => h.orch.getAgent('alpha').status === 'idle', 8000, 'alpha отработал ответ')
		const after = msgs().slice(before)
		assert.equal(after.filter(m => m.kind === 'reply' && m.from === alpha).length, 0, 'alpha не отвечает на ответ')
	})

	it('отправка самому себе и от неизвестного отправителя отклоняются', T, async () => {
		assert.equal((await h.api<ApiError>('POST', '/agents/alpha/send', { from: alpha, text: 'x' })).body.code, 'self_send')
		assert.equal((await h.api<ApiError>('POST', '/agents/alpha/send', { from: 'a-nope', text: 'x' })).body.code, 'bad_from')
		assert.equal((await h.api<ApiError>('POST', '/agents/alpha/send', { text: '   ' })).body.code, 'empty_text')
		assert.equal((await h.api<ApiError>('POST', '/agents/zzz/send', { text: 'x' })).status, 404)
	})

	it('hop limit останавливает зацикливание', T, () => {
		assert.throws(() => h.orch.post({ from: alpha, to: beta, kind: 'msg', text: 'x', hops: 99 }), /зацикливани/)
		assert.throws(() => h.orch.post({ from: alpha, to: beta, kind: 'msg', text: 'x', hops: 9 }), /зацикливани/)
	})

	it('взаимное ожидание (deadlock) → 409', T, async () => {
		const slow = h.api<SendResponse>('POST', `/agents/${beta}/send`, { from: alpha, text: '#slow', wait: true, waitTimeoutSec: 10 })
		await until(() => msgs().some(m => m.from === alpha && m.to === beta && m.text === '#slow'), 3000, 'alpha→beta в ленте')
		const bad = await h.api<ApiError>('POST', `/agents/${alpha}/send`, { from: beta, text: 'встречный', wait: true })
		assert.equal(bad.status, 409)
		assert.equal(bad.body.code, 'deadlock')
		const done = await slow
		assert.equal(done.body.reply?.text, 'медленный ответ')
		// после ответа ожидание снято — встречный wait снова разрешён
		const ok = await h.api<SendResponse>('POST', `/agents/${alpha}/send`, { from: beta, text: 'теперь можно', wait: true, waitTimeoutSec: 10 })
		assert.equal(ok.status, 200)
	})

	it('wait с таймаутом → timedOut', T, async () => {
		const r = await h.api<SendResponse>('POST', '/agents/alpha/send', { text: '#slow', wait: true, waitTimeoutSec: 0.2 })
		assert.equal(r.body.timedOut, true)
		assert.equal(r.body.reply, undefined)
		await until(() => h.orch.getAgent('alpha').status === 'idle', 5000, 'alpha закончил')
	})
})
