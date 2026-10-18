/** Сервис сессий на хранилище в памяти: CRUD, события шины, привязка агентов, раздельные курсоры inbox. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, SessionView } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import { AppError } from '../../../src/domain/errors'
import { FileStore } from '../../../src/infrastructure/persistence/file-store'
import { FakeGateway, FakeSpace, MemoryStore } from '../../support/memory-store'

interface Ctx {
	orch: Orchestrator
	store: MemoryStore
	hub: HubEvent[]
}

function setup(store = new MemoryStore()): Ctx {
	const gw = new FakeGateway()
	let n = 0
	const orch = new Orchestrator({
		settings: { home: os.tmpdir(), autoApprove: true, maxHops: 8, rateLimitPerMinute: 30, cliPath: 'nessy-orch' },
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
		// предсказуемые суффиксы: 0000, 0000 (коллизия), 0001, …
		sessionSuffix: () => String(Math.max(0, n++ - 1)).padStart(4, '0'),
	})
	orch.load()
	if (!orch.graph().spaces.length) orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const hub: HubEvent[] = []
	orch.hub.subscribe(e => hub.push(e))
	return { orch, store, hub }
}

const code = (fn: () => unknown): string => {
	try {
		fn()
	} catch (e) {
		return e instanceof AppError ? `${e.status} ${e.code}` : 'other'
	}
	return 'ok'
}

describe('сессии: сервис', () => {
	let ctx: Ctx
	beforeEach(() => {
		ctx = setup()
	})

	it('create: slug + суффикс, коллизия суффикса перебирается, явный id занят → 409', () => {
		const a = ctx.orch.createSession({ title: 'Починить CI', owner: 'claude' })
		assert.equal(a.id, 'pochinit-ci-0000')
		assert.equal(a.status, 'active')
		assert.equal(a.owner, 'claude')
		assert.equal(a.summary, null)
		const b = ctx.orch.createSession({ title: 'Починить CI' })
		assert.equal(b.id, 'pochinit-ci-0001', 'повторный суффикс 0000 пропущен')
		assert.equal(ctx.orch.createSession({ title: 'x', id: 'mine' }).id, 'mine')
		assert.equal(code(() => ctx.orch.createSession({ title: 'y', id: 'mine' })), '409 session_exists')
		assert.deepEqual(ctx.store.sessions.map(t => t.id).sort(), ['mine', 'pochinit-ci-0000', 'pochinit-ci-0001'])
		assert.equal(ctx.hub.filter(e => e.t === 'session').length, 3)
	})

	it('update: done с итогом, reopen, неизвестная → 404', () => {
		const t = ctx.orch.createSession({ title: 'Отчёт' })
		const done = ctx.orch.updateSession(t.id, { status: 'done', summary: '**готово**' })
		assert.equal(done.status, 'done')
		assert.equal(done.summary, '**готово**')
		assert.equal(ctx.orch.listSessions('active').length, 0)
		assert.equal(ctx.orch.listSessions('done')[0]?.id, t.id)
		const again = ctx.orch.updateSession(t.id, { status: 'active' })
		assert.equal(again.summary, '**готово**', 'итог сохраняется, пока его не сбросят')
		assert.equal(code(() => ctx.orch.updateSession('nope', { title: 'x' })), '404 no_session')
		const last = ctx.hub.filter((e): e is Extract<HubEvent, { t: 'session' }> => e.t === 'session').at(-1)
		assert.equal(last?.session.status, 'active')
	})

	it('spawn: сессия проверяется (no_session), агент агента наследует сессию родителя', async () => {
		const t = ctx.orch.createSession({ title: 'Ящик' })
		await assert.rejects(ctx.orch.spawn({ space: 'main', session: 'nope' }), (e: unknown) => e instanceof AppError && e.code === 'no_session')
		const parent = (await ctx.orch.spawn({ space: 'main', name: 'lead', session: t.id })).agent
		assert.equal(parent.session, t.id)
		const child = (await ctx.orch.spawn({ space: 'main', name: 'helper', from: parent.id })).agent
		assert.equal(child.session, t.id, 'наследуется от родителя')
		const loose = (await ctx.orch.spawn({ space: 'main', name: 'loose' })).agent
		assert.equal(loose.session, null)
		assert.deepEqual(ctx.orch.listAgents(t.id).map(a => a.name).sort(), ['helper', 'lead'])
		assert.equal(ctx.orch.graph().sessions.length, 1)
		assert.equal(ctx.orch.snapshot().sessions[0]?.id, t.id)
	})

	/** Пометить агента «в работе» (в очереди ждёт сообщение): ждать его ответа имеет смысл. */
	const markBusy = (id: string): void => {
		ctx.orch.resolveAgent(id).queue.push({ seq: 0, id: 'm-busy', ts: 0, from: 'you', to: id, kind: 'msg', text: 'ждёт', hops: 0 })
	}

	it('remove: занятый агент → 409 session_busy; иначе агенты отвязываются (session=null)', async () => {
		const t = ctx.orch.createSession({ title: 'Удаляемая' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'w', session: t.id })).agent
		const agent = ctx.orch.resolveAgent(a.id)
		agent.queue.push({ seq: 0, id: 'm-x', ts: 0, from: 'you', to: a.id, kind: 'msg', text: 'ждёт', hops: 0 })
		assert.equal(code(() => ctx.orch.removeSession(t.id)), '409 session_busy')
		agent.queue.length = 0
		ctx.orch.removeSession(t.id)
		assert.equal(ctx.orch.getAgent(a.id).session, null)
		assert.equal(code(() => ctx.orch.getSession(t.id)), '404 no_session')
		assert.ok(ctx.hub.some(e => e.t === 'session_removed' && e.id === t.id))
		assert.ok(ctx.hub.some(e => e.t === 'agent' && e.agent.id === a.id && e.agent.session === null))
	})

	it('wait: свободный агент — сразу done с последним ответом; ответов не было — без reply', async () => {
		const t = ctx.orch.createSession({ title: 'Ожидание' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'w1', session: t.id })).agent.id
		const none = await ctx.orch.waitAgent(a, 5)
		assert.equal(none.done, true)
		assert.equal(none.reply, undefined)
		ctx.orch.post({ from: a, to: 'you', kind: 'reply', text: 'готово' })
		assert.equal((await ctx.orch.waitAgent(a, 5)).reply?.text, 'готово')
	})

	it('wait: работающего ждёт и просыпается, когда он освободился; возвращает его последний ответ', async () => {
		const t = ctx.orch.createSession({ title: 'Ждём' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'w2', session: t.id })).agent.id
		markBusy(a)
		const t0 = Date.now()
		const waiting = ctx.orch.waitAgent(a, 30)
		setTimeout(() => {
			ctx.orch.post({ from: a, to: 'you', kind: 'reply', text: 'итог' })
			ctx.orch.resolveAgent(a).queue.length = 0
			ctx.orch.resolveAgent(a).publishNode()
		}, 40)
		const r = await waiting
		assert.equal(r.done, true)
		assert.equal(r.reply?.text, 'итог')
		assert.ok(Date.now() - t0 < 2000)
	})

	it('wait: время вышло — done=false, агент продолжает; удаление агента завершает ожидание', async () => {
		const t = ctx.orch.createSession({ title: 'Таймаут' })
		const a = (await ctx.orch.spawn({ space: 'main', name: 'w3', session: t.id })).agent.id
		markBusy(a)
		assert.equal((await ctx.orch.waitAgent(a, 0.05)).done, false)
		const waiting = ctx.orch.waitAgent(a, 30)
		setTimeout(() => void ctx.orch.removeAgent(a), 30)
		assert.equal((await waiting).done, true)
	})

	it('агент без --space запускается в каталоге сессии (cwd вкладки), а не в единственном существующем пространстве', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cwd-'))
		const t = ctx.orch.createSession({ cwd: dir, chatId: 'chat-cwd-0001' })
		assert.equal(t.cwd, dir)
		const a = (await ctx.orch.spawn({ name: 'here', session: t.id })).agent
		const space = ctx.orch.graph().spaces.find(x => x.name === a.space)
		assert.equal(fs.realpathSync(space?.path ?? ''), fs.realpathSync(dir), 'пространство = каталог сессии; отдельных каталогов не заводится')
		// явный space важнее
		const b = (await ctx.orch.spawn({ name: 'there', session: t.id, space: 'main' })).agent
		assert.equal(b.space, 'main')
	})

	it('вкладка закрыта: работающие агенты остановлены, сессия и записи остаются, lead = ended', async () => {
		const s = ctx.orch.createSession({ cwd: '/x', chatId: 'chat-0000011' })
		const agent = (await ctx.orch.spawn({ space: 'main', name: 'busy', session: s.id, prompt: 'работай' })).agent.id
		await new Promise(r => setTimeout(r, 20))
		const r = await ctx.orch.sessionClosed(s.id)
		assert.equal(r.cancelled, 1)
				assert.equal(ctx.orch.getAgent(agent).session, s.id, 'агент и сессия не удалены')
		await assert.rejects(() => ctx.orch.sessionClosed('нет-такой'), /не найдена/)
	})

	it('send: свободного агента запускает (started), работающего прерывает (--interrupt) или ставит в очередь', async () => {
		const a = (await ctx.orch.spawn({ space: 'main', name: 'sendee' })).agent.id
		const idle = await ctx.orch.send(a, { text: 'начни', from: 'you' })
		assert.equal(idle.started, true)
		markBusy(a)
		const interrupted = await ctx.orch.send(a, { text: 'срочно', from: 'you', interrupt: true })
		assert.equal(interrupted.interrupted, true)
		const queued = await ctx.orch.send(a, { text: 'потом', from: 'you' })
		assert.equal(queued.queued, true)
	})

	it('рестарт: сессии и привязка агентов восстанавливаются; старые агенты → session=null', async () => {
		const t = ctx.orch.createSession({ title: 'Живучая' })
		await ctx.orch.spawn({ space: 'main', name: 'keeper', session: t.id })
		await ctx.orch.shutdown()
		// агент из старой версии состояния — без поля session
		const legacy = { ...(ctx.store.state.agents[0] as (typeof ctx.store.state.agents)[number]), id: 'a-old', name: 'old' }
		delete legacy.session
		ctx.store.state.agents.push(legacy)
		const next = setup(ctx.store)
		assert.deepEqual(next.orch.listSessions().map((x: SessionView) => x.id), [t.id])
		assert.equal(next.orch.getAgent('keeper').session, t.id)
		assert.equal(next.orch.getAgent('old').session, null)
		await next.orch.shutdown()
	})

	it('attach: transcriptPath пишется в сессию и переживает load() из FileStore; относительный путь → 400', () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-tp-'))
		try {
			const fileStore = new FileStore(home)
			const orch = setup(fileStore as unknown as MemoryStore).orch
			const s = orch.attachSession({ chatId: 'chat-tp-1', cwd: '/tmp/p', transcriptPath: '/t/1.jsonl' })
			assert.equal(s.transcriptPath, '/t/1.jsonl')
			assert.equal(orch.attachSession({ chatId: 'chat-tp-1', transcriptPath: '/t/2.jsonl' }).transcriptPath, '/t/2.jsonl', 'тот же чат: путь обновляется')
			assert.equal(code(() => orch.attachSession({ chatId: 'chat-tp-2', transcriptPath: 'rel' })), '400 bad_request')
			assert.equal(new FileStore(home).loadSessions().find(x => x.id === s.id)?.transcriptPath, '/t/2.jsonl')
		} finally {
			fs.rmSync(home, { recursive: true, force: true })
		}
	})

	it('служебная сессия: ensureService идемпотентна, вне списков и графа, события нет, spawn работает, удалить нельзя', async () => {
		const a = ctx.orch.ensureServiceSession('background', 'Фон', '/tmp/bg')
		const b = ctx.orch.ensureServiceSession('background', 'Другое', '/tmp/other')
		assert.deepEqual(b, a)
		assert.equal(a.service, true)
		assert.equal(ctx.store.sessions.filter(x => x.id === 'background').length, 1, 'на диск сохранена')
		assert.deepEqual(ctx.orch.listSessions().map(x => x.id), [])
		assert.deepEqual(ctx.orch.graph().sessions, [])
		assert.equal(ctx.orch.getSession('background').id, 'background')
		assert.ok(!ctx.hub.some(e => e.t === 'session' && e.session.id === 'background'), 'в шину не публикуется')
		const ag = await ctx.orch.spawn({ space: 'main', name: 'bg1', session: 'background' })
		assert.equal(ag.agent.session, 'background')
		assert.equal(code(() => ctx.orch.removeSession('background')), '409 service_session')
		const next = setup(ctx.store)
		assert.deepEqual(next.orch.listSessions(), [])
		assert.equal(next.orch.getSession('background').service, true, 'после перезапуска остаётся служебной')
		await next.orch.shutdown()
	})
})
