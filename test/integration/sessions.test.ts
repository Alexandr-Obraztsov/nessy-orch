/** Сессии по HTTP: CRUD, spawn в сессии и наследование, поток, рестарт; CLI: ожидание результата. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { AgentView, ApiError, GraphView, SpawnResponse, StreamEvent, SessionView } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 30000 }
const CLI_MAIN = path.join(__dirname, '..', '..', 'src', 'interfaces', 'cli', 'main.js')

describe('сессии (HTTP)', () => {
	let h: Harness
	let t1: SessionView
	let t2: SessionView

	before(async () => {
		h = await startHarness()
		assert.equal((await h.api('POST', '/spaces', { path: h.ws, name: 'main' })).status, 201)
	})
	after(() => h.close())

	it('POST /sessions: id из заголовка + 4 hex; явный id; ошибки', T, async () => {
		const r = await h.api<SessionView>('POST', '/sessions', { title: 'Починить CI', owner: 'claude-1' })
		assert.equal(r.status, 201)
		t1 = r.body
		assert.match(t1.id, /^pochinit-ci-[0-9a-f]{4}$/)
		assert.equal(t1.owner, 'claude-1')
		assert.equal(t1.status, 'active')
		const r2 = await h.api<SessionView>('POST', '/sessions', { title: 'Обзор MR', owner: 'claude-2', id: 'review-mr' })
		t2 = r2.body
		assert.equal(t2.id, 'review-mr')
		const dup = await h.api<ApiError>('POST', '/sessions', { title: 'x', id: 'review-mr' })
		assert.equal(dup.status, 409)
		assert.equal(dup.body.code, 'session_exists')
		assert.equal((await h.api<ApiError>('POST', '/sessions', { owner: 'x' })).status, 400)
		assert.equal((await h.api<ApiError>('GET', '/sessions/nope')).body.code, 'no_session')
		assert.equal((await h.api<SessionView>('GET', `/sessions/${t1.id}`)).body.title, 'Починить CI')
		assert.equal((await h.api<SessionView[]>('GET', '/sessions')).body.length, 2)
		assert.equal((await h.api<GraphView>('GET', '/graph')).body.sessions.length, 2)
	})

	it('POST /agents с session: проверка no_session, наследование сессии от агента-родителя, GET /agents?session=', T, async () => {
		const bad = await h.api<ApiError>('POST', '/agents', { space: 'main', session: 'nope' })
		assert.equal(bad.status, 404)
		assert.equal(bad.body.code, 'no_session')
		const lead = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'lead-1', session: t1.id })
		assert.equal(lead.body.agent.session, t1.id)
		const sub = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'sub-1', from: lead.body.agent.id })
		assert.equal(sub.body.agent.session, t1.id, 'агент, запущенный агентом, наследует сессию')
		await h.api('POST', '/agents', { space: 'main', name: 'lead-2', session: t2.id })
		const in1 = await h.api<AgentView[]>('GET', `/agents?session=${t1.id}`)
		assert.deepEqual(in1.body.map(a => a.name).sort(), ['lead-1', 'sub-1'])
		assert.equal((await h.api<ApiError>('GET', '/agents?session=nope')).status, 404)
		assert.equal((await h.api<AgentView[]>('GET', '/agents')).body.length, 3)
	})

	it('PATCH /sessions/:id: done с итогом и reopen; события session в /stream', T, async () => {
		const s = await h.sse('/stream')
		const snap = await s.waitFor((e): e is Extract<StreamEvent, { t: 'snapshot' }> => (e as StreamEvent).t === 'snapshot')
		assert.equal(snap.sessions.length, 2)
		const d = await h.api<SessionView>('PATCH', `/sessions/${t2.id}`, { status: 'done', summary: 'итог: готово' })
		assert.equal(d.status, 200)
		assert.equal(d.body.status, 'done')
		assert.equal(d.body.summary, 'итог: готово')
		await s.waitFor((e): e is StreamEvent => (e as StreamEvent).t === 'session' && (e as Extract<StreamEvent, { t: 'session' }>).session.status === 'done')
		assert.equal((await h.api<SessionView[]>('GET', '/sessions?status=active')).body.length, 1)
		assert.equal((await h.api<ApiError>('PATCH', `/sessions/${t2.id}`, { status: 'closed' })).status, 400)
		assert.equal((await h.api<SessionView>('PATCH', `/sessions/${t2.id}`, { status: 'active' })).body.status, 'active')
		s.close()
	})

	it('DELETE /sessions/:id: занятая сессия → 409, свободная удаляется, агенты остаются с session=null', T, async () => {
		await h.api('POST', '/agents/lead-2/send', { text: '#slow' })
		await until(() => h.orch.getAgent('lead-2').status === 'working', 8000, 'агент работает')
		const busy = await h.api<ApiError>('DELETE', `/sessions/${t2.id}`)
		assert.equal(busy.status, 409)
		assert.equal(busy.body.code, 'session_busy')
		await h.api('POST', '/agents/lead-2/cancel', {})
		await until(() => h.orch.getAgent('lead-2').status !== 'working' && !h.orch.resolveAgent('lead-2').queue.length, 8000, 'агент свободен')
		const s = await h.sse('/stream')
		assert.equal((await h.api('DELETE', `/sessions/${t2.id}`)).status, 200)
		await s.waitFor((e): e is StreamEvent => (e as StreamEvent).t === 'session_removed')
		s.close()
		assert.equal(h.orch.getAgent('lead-2').session, null)
		assert.equal((await h.api('GET', `/sessions/${t2.id}`)).status, 404)
	})

	it('рестарт: сессии и привязка агентов восстанавливаются', T, async () => {
		const base = h.base
		await h.close({ keepFiles: true })
		h = await startHarness({ base })
		assert.deepEqual(h.orch.listSessions().map(t => t.id), [t1.id])
		assert.equal(h.orch.getAgent('lead-1').session, t1.id)
		assert.equal(h.orch.getAgent('sub-1').session, t1.id)
	})
})

describe('чат Claude ↔ сессия: attach и хук SessionStart', () => {
	let h: Harness | null = null
	after(async () => {
		await h?.close()
	})

	const hook = (port: number, session: string, stdin: object, extra: NodeJS.ProcessEnv = {}): Promise<number | null> =>
		new Promise(resolve => {
			const p = spawn(process.execPath, [CLI_MAIN, 'hook', 'start'], { env: { ...process.env, ORCH_PORT: String(port), NO_COLOR: '1', NESSY_ORCH_SESSION: session, ...extra } })
			p.on('close', code => resolve(code))
			p.stdin.end(JSON.stringify(stdin))
		})

	it('attach: чат уже привязан — та же сессия; новый чат (/clear) — новая сессия в той же папке, прежняя получает successor', T, async () => {
		h = await startHarness()
		const hh = h
		const first = (await hh.api<SessionView>('POST', '/sessions', { cwd: '/tmp/attach-proj', chatId: 'chat-aaaa-0001' })).body
		const same = await hh.api<SessionView>('POST', '/sessions/attach', { chatId: 'chat-aaaa-0001', from: first.id })
		assert.equal(same.body.id, first.id)
		assert.ok(!(await hh.api<SessionView>('GET', `/sessions/${first.id}`)).body.successor)
		const next = await hh.api<SessionView>('POST', '/sessions/attach', { chatId: 'chat-aaaa-0002', cwd: '/tmp/attach-proj', from: first.id })
		assert.notEqual(next.body.id, first.id)
		assert.equal(next.body.chatId, 'chat-aaaa-0002')
		assert.equal(next.body.cwd, '/tmp/attach-proj')
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${first.id}`)).body.successor, next.body.id)
		// /resume старого чата: сессия находится, цепочка разворачивается (у возвращённой преемника нет)
		const back = await hh.api<SessionView>('POST', '/sessions/attach', { chatId: 'chat-aaaa-0001', from: next.body.id })
		assert.equal(back.body.id, first.id)
		assert.ok(!back.body.successor)
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${next.body.id}`)).body.successor, first.id)
		assert.equal((await hh.api<ApiError>('POST', '/sessions/attach', { chatId: 'плохой id' })).status, 400)
		assert.equal((await hh.api<ApiError>('POST', '/sessions/attach', {})).status, 400)
	})

	it('hook start: после /clear создаёт сессию нового чата и записывает её id в CLAUDE_ENV_FILE; тот же чат — файл не трогает', T, async () => {
		const hh = h
		assert.ok(hh)
		const first = (await hh.api<SessionView>('POST', '/sessions', { cwd: '/tmp/hook-proj', chatId: 'chat-bbbb-0001' })).body
		const envFile = path.join(hh.base, 'claude-env')
		assert.equal(await hook(hh.port, first.id, { session_id: 'chat-bbbb-0001', cwd: '/tmp/hook-proj', source: 'startup' }, { CLAUDE_ENV_FILE: envFile }), 0)
		assert.ok(!fs.existsSync(envFile), 'сессия та же — переменную менять незачем')
		assert.equal(await hook(hh.port, first.id, { session_id: 'chat-bbbb-0002', cwd: '/tmp/hook-proj', source: 'clear' }, { CLAUDE_ENV_FILE: envFile }), 0)
		const created = (await hh.api<SessionView[]>('GET', '/sessions')).body.find(x => x.chatId === 'chat-bbbb-0002')
		assert.ok(created)
		assert.match(fs.readFileSync(envFile, 'utf8'), new RegExp(`export NESSY_ORCH_SESSION='${created.id}'`))
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${first.id}`)).body.successor, created.id)
		// без переменной окружения (вне приложения) и без чата хук молчит
		assert.equal(await hook(hh.port, '', { session_id: 'chat-bbbb-0003' }, { CLAUDE_ENV_FILE: envFile }), 0)
		assert.ok(!(await hh.api<SessionView[]>('GET', '/sessions')).body.some(x => x.chatId === 'chat-bbbb-0003'))
	})
})

describe('CLI: spawn и send ждут результат сами, wait, --no-wait', () => {
	let h: Harness | null = null
	after(async () => {
		await h?.close()
	})

	const cli = (port: number, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> =>
		new Promise(resolve => {
			const p = spawn(process.execPath, [CLI_MAIN, ...args], { env: { ...process.env, ORCH_PORT: String(port), NO_COLOR: '1', NESSY_ORCH_SESSION: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
			let stdout = ''
			let stderr = ''
			p.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
			p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
			p.on('close', code => resolve({ code, stdout, stderr }))
		})

	it('spawn по умолчанию ждёт и печатает ответ агента; send тоже; --no-wait возвращается сразу', T, async () => {
		h = await startHarness()
		const hh = h
		await hh.api('POST', '/spaces', { path: hh.ws, name: 'main' })
		const s = (await hh.api<SessionView>('POST', '/sessions', { title: 'CLI' })).body.id
		const a = await cli(hh.port, ['spawn', '--session', s, '--space', 'main', '--title', 'Первое дело', 'сделай раз'])
		assert.equal(a.code, 0, a.stderr)
		assert.equal(a.stdout.trim(), 'ответ: сделай раз')
		assert.match(a.stderr, /✓ агент agent «Первое дело»/, 'имя назначил оркестратор и вывел; заголовок отдельно')
		const b = await cli(hh.port, ['send', 'agent', 'сделай два'])
		assert.equal(b.code, 0, b.stderr)
		assert.equal(b.stdout.trim(), 'ответ: сделай два')
		const c = await cli(hh.port, ['send', 'agent', 'без ожидания', '--no-wait'])
		assert.equal(c.code, 0)
		assert.equal(c.stdout.trim(), '', 'ответа в выводе нет')
		assert.match(c.stderr, /nessy-orch wait/)
	})

	it('wait: свободный агент — сразу его последний ответ; работающий — код 3 по таймауту и подсказка; затем ответ', T, async () => {
		const hh = h
		assert.ok(hh)
		const s = (await hh.api<SessionView>('POST', '/sessions', { title: 'Ожидание' })).body.id
		await hh.api('POST', '/agents', { space: 'main', name: 'slow', session: s, prompt: '#slow' })
		const early = await cli(hh.port, ['wait', 'slow', '--timeout', '0'])
		assert.equal(early.code, 3)
		assert.match(early.stderr, /ещё работает/)
		const done = await cli(hh.port, ['wait', 'slow', '--timeout', '20'])
		assert.equal(done.code, 0, done.stderr)
		assert.match(done.stdout, /медленный ответ/)
		const idle = await cli(hh.port, ['wait', 'slow'])
		assert.equal(idle.code, 0, 'свободный агент — сразу')
	})

	it('агент (--from) по умолчанию не ждёт: ответ придёт ему сообщением', T, async () => {
		const hh = h
		assert.ok(hh)
		const lead = (await hh.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'boss' })).body.agent
		await hh.api('POST', '/agents', { space: 'main', name: 'helper2' })
		const r = await cli(hh.port, ['send', 'helper2', 'привет', '--from', lead.id])
		assert.equal(r.code, 0, r.stderr)
		assert.equal(r.stdout.trim(), '')
	})
})
