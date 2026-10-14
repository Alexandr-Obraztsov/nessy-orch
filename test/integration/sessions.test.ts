/** Сессии по HTTP: CRUD, spawn в сессии и наследование, inbox по сессиям (два оркестратора), поток, рестарт. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { AgentView, ApiError, GraphView, InboxResponse, SpawnBatchResponse, SpawnResponse, StreamEvent, SessionView } from '../../shared/types'
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

	it('два оркестратора: у каждой сессии свой inbox и курсор, ответы не крадутся', T, async () => {
		await h.api('GET', '/inbox') // общий курсор — в конец
		await h.api('POST', '/agents/lead-2/send', { text: 'для второго' })
		await h.api('POST', '/agents/lead-1/send', { text: 'для первого' })
		const w1 = h.api<InboxResponse>('GET', `/inbox?session=${t1.id}&wait=10`)
		const w2 = h.api<InboxResponse>('GET', `/inbox?session=${t2.id}&wait=10`)
		const [r1, r2] = await Promise.all([w1, w2])
		assert.deepEqual(r1.body.messages.map(m => m.text), ['ответ: для первого'])
		assert.deepEqual(r2.body.messages.map(m => m.text), ['ответ: для второго'])
		assert.deepEqual((await h.api<InboxResponse>('GET', `/inbox?session=${t1.id}`)).body.messages, [], 'курсор первой сессии сдвинут')
		assert.deepEqual((await h.api<InboxResponse>('GET', `/inbox?session=${t2.id}&peek=1`)).body.messages, [])
		// прежний общий inbox без session видит всё, со своим курсором
		const all = await h.api<InboxResponse>('GET', '/inbox?peek=1')
		assert.deepEqual(all.body.messages.map(m => m.text).sort(), ['ответ: для второго', 'ответ: для первого'])
		const again = await h.api<InboxResponse>('GET', `/inbox?session=${t1.id}&after=0`)
		assert.equal(again.body.messages.length, 1, 'after читает с позиции, не двигая курсор')
		assert.equal((await h.api<ApiError>('GET', '/inbox?session=nope')).body.code, 'no_session')
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
		assert.deepEqual((await h.api<InboxResponse>('GET', `/inbox?session=${t1.id}`)).body.messages, [], 'курсор сессии сохранён')
	})
})

describe('пакетный запуск агентов', () => {
	let h: Harness | null = null
	after(async () => {
		await h?.close()
	})

	it('POST /agents/batch: несколько агентов за вызов, ошибка одного не мешает остальным, cwd выбирает пространство', T, async () => {
		h = await startHarness()
		const s = await h.api<SessionView>('POST', '/sessions', { title: 'Пакет' })
		const r = await h.api<SpawnBatchResponse>('POST', '/agents/batch', {
			cwd: h.ws,
			session: s.body.id,
			agents: [
				{ name: 'one', prompt: 'первое' },
				{ name: 'two', prompt: 'второе' },
				{ name: 'one', prompt: 'дубль имени' },
			],
		})
		assert.equal(r.status, 201)
		assert.deepEqual(
			r.body.results.map(x => (x.ok ? ['ok', x.agent.name, x.agent.session] : ['fail', x.code])),
			[
				['ok', 'one', s.body.id],
				['ok', 'two', s.body.id],
				['fail', 'name_taken'],
			],
		)
		assert.equal(h.orch.graph().spaces.length, 1, 'пространство создано по cwd вызывающего')
		const bad = await h.api('POST', '/agents/batch', { agents: [] })
		assert.equal(bad.status, 400)
	})
})

describe('хуки Claude Code (updates, ping, CLI hook)', () => {
	let h: Harness | null = null
	after(async () => {
		await h?.close()
	})

	const runHook = (port: number, session: string | undefined, event: string, stdin = '{}', extraEnv: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> =>
		new Promise(resolve => {
			const env: NodeJS.ProcessEnv = { ...process.env, ORCH_PORT: String(port), NO_COLOR: '1', ...extraEnv }
			delete env['NESSY_ORCH_SESSION']
			if (session) env['NESSY_ORCH_SESSION'] = session
			const p = spawn(process.execPath, [CLI_MAIN, 'hook', event], { env })
			let stdout = ''
			let stderr = ''
			p.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
			p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
			p.on('close', code => resolve({ code, stdout, stderr }))
			p.stdin.end(stdin)
		})

	it('ping меняет состояние Claude и публикуется; updates отдаёт агентов и ответы с общим курсором inbox', T, async () => {
		h = await startHarness()
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
		const s = await h.api<SessionView>('POST', '/sessions', { title: 'Хуки' })
		const ping = await h.api<SessionView>('POST', `/sessions/${s.body.id}/lead-state`, { state: 'working' })
		assert.equal(ping.body.lead?.state, 'working')
		assert.equal((await h.api('POST', `/sessions/${s.body.id}/lead-state`, { state: 'sleeping' })).status, 400)
		assert.equal((await h.api<SessionView>('GET', `/sessions/${s.body.id}`)).body.lead?.state, 'working')

		await h.api('POST', '/agents', { space: 'main', name: 'worker', session: s.body.id, prompt: 'сделай', wait: true, waitTimeoutSec: 8 })
		const peek = await h.api<{ agents: Array<{ name: string }>; replies: unknown[]; cursor: number }>('GET', `/sessions/${s.body.id}/updates`)
		assert.equal(peek.body.agents[0]?.name, 'worker')
		assert.equal(peek.body.replies.length, 1, 'просмотр ответ не потребляет')
		assert.ok(peek.body.cursor > 0, 'в ответе есть курсор для подтверждения')
		// двухфазная доставка: пока не подтверждено, ответ приходит снова; подтверждение идемпотентно и не откатывает курсор
		assert.equal((await h.api<{ replies: unknown[] }>('GET', `/sessions/${s.body.id}/updates`)).body.replies.length, 1)
		assert.equal((await h.api('POST', `/sessions/${s.body.id}/ack`, {})).status, 400)
		assert.equal((await h.api('POST', `/sessions/${s.body.id}/ack`, { cursor: peek.body.cursor })).status, 200)
		assert.equal((await h.api<{ replies: unknown[] }>('GET', `/sessions/${s.body.id}/updates`)).body.replies.length, 0, 'после ack пусто')
		assert.equal((await h.api('POST', `/sessions/${s.body.id}/ack`, { cursor: 0 })).status, 200)
		assert.equal((await h.api<{ replies: unknown[] }>('GET', `/sessions/${s.body.id}/updates`)).body.replies.length, 0, 'ack назад курсор не двигает')
		assert.equal((await h.api<InboxResponse>('GET', `/inbox?session=${s.body.id}&peek=1`)).body.messages.length, 0, 'курсор общий с inbox сессии')
	})

	it('CLI hook: старт — контекст, prompt — сводка, без переменной — тишина, Stop блокирует при новых ответах', T, async () => {
		const hh = h
		assert.ok(hh)
		const s = await hh.api<SessionView>('POST', '/sessions', { title: 'CLI-хуки' })
		const start = await runHook(hh.port, s.body.id, 'start')
		assert.equal(start.code, 0)
		assert.match(start.stdout, new RegExp(s.body.id), 'контекст старта — простой текст в stdout')
		assert.ok(!start.stdout.trimStart().startsWith('{'), 'не JSON: схема вывода хуков не нужна')
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${s.body.id}`)).body.lead?.state, 'idle')

		const silent = await runHook(hh.port, undefined, 'prompt')
		assert.deepEqual(silent, { code: 0, stdout: '', stderr: '' }, 'без NESSY_ORCH_SESSION хук молчит')

		const calm = await runHook(hh.port, s.body.id, 'prompt')
		assert.equal(calm.stdout, '', 'агентов и ответов нет — нечего сообщать')
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${s.body.id}`)).body.lead?.state, 'working')

		await hh.api('POST', '/agents', { space: 'main', name: 'helper', session: s.body.id, prompt: 'сделай', wait: true, waitTimeoutSec: 8 })
		const stop = await runHook(hh.port, s.body.id, 'stop')
		assert.equal(stop.code, 2, 'код 2: не останавливаться; причина — в stderr')
		assert.match(stop.stderr, /helper/)
		const stop2 = await runHook(hh.port, s.body.id, 'stop')
		assert.equal(stop2.code, 0, 'ответ доставлен один раз')
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${s.body.id}`)).body.lead?.state, 'idle')

		await runHook(hh.port, s.body.id, 'end')
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${s.body.id}`)).body.lead?.state, 'ended')
	})

	it('привязка чата Claude: первый чат окна берёт сессию окна, resume возвращает её, новый чат — новая сессия в том же окне', T, async () => {
		const hh = h
		assert.ok(hh)
		const w = await hh.api<SessionView>('POST', '/sessions', { title: 'Окно' })
		const envFile = path.join(hh.ws, 'claude-env')
		const ev = (id: string): string => JSON.stringify({ session_id: id })
		await runHook(hh.port, w.body.id, 'start', ev('chat-a'), { CLAUDE_ENV_FILE: envFile })
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${w.body.id}`)).body.chatId, 'chat-a')

		// новый чат в том же окне (/clear) — новая сессия, а Bash-инструменты получают её id
		await runHook(hh.port, w.body.id, 'start', ev('chat-b'), { CLAUDE_ENV_FILE: envFile })
		const all = (await hh.api<SessionView[]>('GET', '/sessions')).body
		const b = all.find(x => x.chatId === 'chat-b')
		assert.ok(b && b.id !== w.body.id)
		assert.equal(b.origin, w.body.id)
		assert.equal(b.lead?.state, 'idle')
		assert.match(fs.readFileSync(envFile, 'utf8'), new RegExp(`NESSY_ORCH_SESSION='${b.id}'`))

		// resume первого чата: возвращается его же сессия, второй раз ничего не создаётся
		const before = (await hh.api<SessionView[]>('GET', '/sessions')).body.length
		const resumed = await runHook(hh.port, w.body.id, 'start', ev('chat-a'))
		assert.equal((await hh.api<SessionView[]>('GET', '/sessions')).body.length, before, 'resume не создаёт новую сессию')
		assert.match(resumed.stdout, new RegExp(w.body.id), 'контекст старта — про возобновлённую сессию')
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${w.body.id}`)).body.lead?.state, 'idle')
		await runHook(hh.port, w.body.id, 'prompt', ev('chat-a'))
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${w.body.id}`)).body.lead?.state, 'working')
	})

	it('CLI: inbox без работающих агентов — код 4 сразу; spawn-many позиционно создаёт агентов в сессии', T, async () => {
		const hh = h
		assert.ok(hh)
		const cli = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
			new Promise(resolve => {
				const p = spawn(process.execPath, [CLI_MAIN, ...args], { env: { ...process.env, ORCH_PORT: String(hh.port), NO_COLOR: '1', NESSY_ORCH_SESSION: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
				let stdout = ''
				let stderr = ''
				p.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
				p.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
				p.on('close', code => resolve({ code, stdout, stderr }))
			})
		const sess = (await hh.api<SessionView>('POST', '/sessions', { title: 'CLI-ожидание' })).body.id
		const t0 = Date.now()
		const idle = await cli(['inbox', '--session', sess, '--wait', '30'])
		assert.equal(idle.code, 4)
		assert.match(idle.stderr, /ждать нечего/)
		assert.ok(Date.now() - t0 < 5000, 'не зависает на весь --wait')
		const many = await cli(['spawn-many', '--session', sess, 'пара-1||Сделай раз', 'пара-2||Сделай два'])
		assert.equal(many.code, 0, many.stderr)
		assert.match(many.stdout, /пара-1/)
		assert.match(many.stdout, /пара-2/)
		const bad = await cli(['spawn-many', '--session', sess])
		assert.equal(bad.code, 2)
		assert.match(bad.stderr, /имя\|роль\|поручение/)
	})

	it('терминал без заранее созданной сессии: сессия рождается по хуку из session_id чата и привязана к терминалу', T, async () => {
		const hh = h
		assert.ok(hh)
		const ev = (id: string): string => JSON.stringify({ session_id: id, cwd: '/Users/me/proj' })
		const envFile = path.join(hh.ws, 'claude-env-2')
		const startA = await runHook(hh.port, undefined, 'start', ev('term-chat-a'), { NESSY_ORCH_TERMINAL: 'term-1', CLAUDE_ENV_FILE: envFile })
		assert.equal(startA.code, 0)
		const a = (await hh.api<SessionView[]>('GET', '/sessions')).body.find(x => x.chatId === 'term-chat-a')
		assert.ok(a)
		assert.equal(a.origin, 'term-1')
		assert.equal(a.title, 'proj', 'название — по папке чата')
		assert.match(fs.readFileSync(envFile, 'utf8'), new RegExp(`NESSY_ORCH_SESSION='${a.id}'`))
		// /clear — новый чат в том же терминале: новая сессия с тем же origin
		await runHook(hh.port, undefined, 'start', ev('term-chat-b'), { NESSY_ORCH_TERMINAL: 'term-1' })
		const b = (await hh.api<SessionView[]>('GET', '/sessions')).body.find(x => x.chatId === 'term-chat-b')
		assert.ok(b && b.id !== a.id && b.origin === 'term-1')
		// /resume первого чата в другом терминале: его сессия переезжает туда, дубля нет
		const before = (await hh.api<SessionView[]>('GET', '/sessions')).body.length
		await runHook(hh.port, undefined, 'start', ev('term-chat-a'), { NESSY_ORCH_TERMINAL: 'term-2' })
		const all = (await hh.api<SessionView[]>('GET', '/sessions')).body
		assert.equal(all.length, before)
		assert.equal(all.find(x => x.id === a.id)?.origin, 'term-2')
	})

	it('хуки nessy: контекст — JSON hookSpecificOutput.additionalContext, Stop возвращает к ожиданию, stop-failure освобождает', T, async () => {
		const hh = h
		assert.ok(hh)
		const s = await hh.api<SessionView>('POST', '/sessions', { title: 'nessy-хуки' })
		const env = { NESSY_ORCH_LEAD: 'nessy' }
		const start = await runHook(hh.port, s.body.id, 'start', '{}', env)
		const j = JSON.parse(start.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
		assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart')
		assert.match(j.hookSpecificOutput.additionalContext, /~\/\.nessy\/skills/)
		await hh.api('POST', '/agents', { space: 'main', name: 'nessy-work', session: s.body.id, prompt: '#slow' })
		const stop = await runHook(hh.port, s.body.id, 'stop', JSON.stringify({ stop_hook_active: true }), env)
		assert.equal(stop.code, 2)
		assert.match(stop.stderr, /--wait 50/)
		await runHook(hh.port, s.body.id, 'stop-failure', '{}', env)
		assert.equal((await hh.api<SessionView>('GET', `/sessions/${s.body.id}`)).body.lead?.state, 'idle')
	})

	it('хук не ломает Claude при недоступном оркестраторе', T, async () => {
		const r = await runHook(1, 'any', 'prompt')
		assert.deepEqual(r, { code: 0, stdout: '', stderr: '' })
	})
})
