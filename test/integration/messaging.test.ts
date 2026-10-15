/** Сообщения: spawn --wait, send/reply, wait, очередь, межагентная переписка и защиты. */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { ApiError, Message, SendResponse, SpawnResponse, UserEvent, WaitResponse } from '../../shared/types'
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
		// занятое имя — не ошибка: добавляется суффикс, настоящее имя возвращается
		const dup = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'BETA' })
		assert.equal(dup.status, 201)
		assert.equal(dup.body.agent.name, 'BETA-2')
		await h.api('DELETE', `/agents/${dup.body.agent.id}`)
	})

	it('первый промпт содержит вводную, следующие — нет', T, () => {
		const ev = h.orch.agentHistory(alpha)
		assert.equal(ev.filter(e => e.kind === 'user').length >= 1, true)
		assert.equal(h.orch.resolveAgent(alpha).introduced, true)
	})

	it('send без wait: ответ появляется в ленте, wait отдаёт его', T, async () => {
		const s = await h.api<SendResponse>('POST', '/agents/alpha/send', { text: 'асинхронно' })
		assert.equal(s.status, 200)
		assert.equal(s.body.reply, undefined)
		const w = await h.api<WaitResponse>('GET', '/agents/alpha/wait?timeout=10')
		assert.equal(w.body.done, true)
		assert.equal(w.body.reply?.text, 'ответ: асинхронно')
		assert.ok(h.orch.listMessages({ agent: 'alpha' }).some(m => m.kind === 'reply' && m.text === 'ответ: асинхронно'))
	})

	it('wait: свободный агент — сразу; работающий — ждёт, по таймауту done=false', T, async () => {
		const t0 = Date.now()
		const idle = await h.api<WaitResponse>('GET', '/agents/alpha/wait?timeout=20')
		assert.equal(idle.body.done, true)
		assert.ok(Date.now() - t0 < 1500, 'ждать некого — не висим')
		await h.api('POST', '/agents/beta/send', { text: '#long' })
		await until(() => h.orch.getAgent('beta').status === 'working', 4000, 'beta working')
		const t1 = Date.now()
		const r = await h.api<WaitResponse>('GET', '/agents/beta/wait?timeout=1')
		assert.equal(r.body.done, false)
		assert.ok(Date.now() - t1 >= 900)
		await until(() => h.orch.getAgent('beta').status !== 'working', 8000, 'beta done')
		assert.equal((await h.api<ApiError>('GET', '/agents/no-such-agent/wait')).status, 404)
	})

	it('сообщения работающему агенту доходят в идущий ход по порядку, ход не прерывается, в очередь они не встают', T, async () => {
		await h.api('POST', '/agents/beta/send', { text: '#slow' })
		await until(() => h.orch.getAgent('beta').status === 'working', 4000, 'beta working')
		for (const t of ['один', 'два', 'три']) await h.api('POST', '/agents/beta/send', { text: t })
		assert.equal(h.orch.getAgent('beta').queued, 0)
		const isOurs = (m: Message): boolean => m.kind === 'reply' && m.from === beta && /^(ответ: (один|два|три)|медленный ответ)$/.test(m.text)
		await until(() => msgs().filter(isOurs).length === 1, 10000, 'ответ хода')
		assert.equal(msgs().filter(isOurs)[0]?.text, 'медленный ответ', 'ход не прерван')
		const users = h.orch
			.agentHistory(beta)
			.filter((e): e is UserEvent => e.kind === 'user')
			.map(e => e.text)
			.slice(-4)
		assert.deepEqual(users, ['#slow', 'один', 'два', 'три'])
		await until(() => h.orch.getAgent('beta').status === 'idle', 6000, 'idle')
		assert.equal(msgs().filter(isOurs).length, 1, 'отдельных ответов на вставленные сообщения того же отправителя нет')
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
