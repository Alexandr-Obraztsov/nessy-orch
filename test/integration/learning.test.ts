/** Фоновое обучение, сборка в приложение: закрытие вкладки → служебный агент-сборщик → готовый кейс; рестарт посреди работы. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { AgentView, ApiError, BackfillCandidate, BackfillResult, CaseDetail, LearningView, SessionView, SpawnResponse, StreamEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import { repoRoot } from '../support/repo-root'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 60000 }
const REPLY = '<summary>\n# T\n## Goal: g (type: t)\n</summary>\n<meta>{"title":"T","goals":[{"title":"g","type":"t"}]}</meta>\nСтатус: DONE'

describe('фоновое обучение (сборка)', () => {
	let h: Harness | null = null
	let base = ''
	let prevHome: string | undefined

	beforeEach(() => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-learn-'))
		fs.mkdirSync(path.join(base, 'home'), { recursive: true })
		prevHome = process.env['NESSY_ORCH_HOME']
		// фейковый serve читает сценарии из $NESSY_ORCH_HOME
		process.env['NESSY_ORCH_HOME'] = path.join(base, 'home')
	})
	afterEach(async () => {
		await h?.close()
		h = null
		if (prevHome === undefined) delete process.env['NESSY_ORCH_HOME']
		else process.env['NESSY_ORCH_HOME'] = prevHome
		fs.rmSync(base, { recursive: true, force: true })
	})

	const scenarios = (v: unknown): void => fs.writeFileSync(path.join(base, 'home', 'fake-scenarios.json'), JSON.stringify(v))

	async function work(hh: Harness): Promise<SessionView> {
		assert.equal((await hh.api('POST', '/spaces', { path: hh.ws, name: 'main' })).status, 201)
		const s = (await hh.api<SessionView>('POST', '/sessions', { title: 'Работа' })).body
		const r = await hh.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'worker', session: s.id, prompt: 'сделай задачу', wait: true })
		assert.equal(r.status, 201)
		return s
	}

	it('закрытие вкладки → кейс ready, summary.md, агент в сессии background архивирован', T, async () => {
		scenarios({ 'SESSION COLLECTOR': [{ text: REPLY }] })
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const stream = await h.sse('/stream')
		const s = await work(h)
		assert.equal((await h.api('POST', `/sessions/${s.id}/closed`)).status, 200)
		const ready = await stream.waitFor(
			(e): e is Extract<StreamEvent, { t: 'learning_case' }> => (e as StreamEvent).t === 'learning_case' && (e as { case: { status: string } }).case.status === 'ready',
			40000,
			'learning_case ready',
		)
		stream.close()
		assert.equal(ready.case.title, 'T')
		const summary = fs.readFileSync(path.join(h.home, 'cases', `c-${s.id}`, 'summary.md'), 'utf8')
		assert.match(summary, /# T/)
		// фоновый агент удалён из реестра, ответ лежит в runs/
		const agents = (await h.api<AgentView[]>('GET', '/agents')).body.filter(a => a.session === 'background')
		assert.equal(agents.length, 0)
		const runs = fs.readdirSync(path.join(h.home, 'cases', `c-${s.id}`, 'runs'))
		assert.equal(runs.length, 1)
		assert.match(fs.readFileSync(path.join(h.home, 'cases', `c-${s.id}`, 'runs', runs[0] ?? ''), 'utf8'), /Статус: DONE/)
		const sessions = (await h.api<SessionView[]>('GET', '/sessions')).body
		assert.ok(!sessions.some(x => x.id === 'background'), 'служебная сессия скрыта')
		assert.deepEqual(sessions.map(x => x.id), [s.id])
	})

	it('рестарт посреди работы сборщика: задание выполняется заново, кейс один, jobs.json без running', T, async () => {
		scenarios({ 'SESSION COLLECTOR': [{ hang: 'думаю' }] })
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const s = await work(h)
		await h.api('POST', `/sessions/${s.id}/closed`)
		const learning = h.orch.learning
		assert.ok(learning)
		await until(() => learning.view().jobs.some(j => j.status === 'running'), 20000, 'задание запущено')
		await h.close({ keepFiles: true })

		scenarios({ 'SESSION COLLECTOR': [{ text: REPLY }] })
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const again = h.orch.learning
		assert.ok(again)
		await until(() => again.view().cases.some(c => c.status === 'ready'), 40000, 'кейс ready после рестарта')
		assert.equal(again.view().cases.length, 1)
		const jobs = JSON.parse(fs.readFileSync(path.join(h.home, 'learning', 'jobs.json'), 'utf8')) as Array<{ status: string }> | { jobs: Array<{ status: string }> }
		const list = Array.isArray(jobs) ? jobs : jobs.jobs
		assert.ok(!list.some(j => j.status === 'running'))
		assert.match(fs.readFileSync(path.join(h.home, 'cases', `c-${s.id}`, 'summary.md'), 'utf8'), /# T/)
	})

	const CLI = path.join(repoRoot(), 'bin', 'nessy-orch')
	const cli = (hh: Harness, ...args: string[]): Promise<{ code: number; out: string }> =>
		new Promise(resolve => {
			execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ORCH_PORT: String(hh.port), NO_COLOR: '1' } }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: stdout + stderr }))
		})

	it('настройки: PATCH пишет learning.json, правка файла руками подхватывается тиком без рестарта', T, async () => {
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const stream = await h.sse('/stream')
		const r = await h.api<LearningView['settings']>('PATCH', '/learning/settings', { enabled: false, maxAgents: 3 })
		assert.equal(r.status, 200)
		assert.equal(r.body.enabled, false)
		await stream.waitFor((e): e is Extract<StreamEvent, { t: 'learning_settings' }> => (e as StreamEvent).t === 'learning_settings', 10000, 'learning_settings')
		stream.close()
		const file = path.join(h.home, 'learning.json')
		const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as LearningView['settings']
		assert.equal(saved.enabled, false)
		assert.equal(saved.maxAgents, 3)
		assert.equal((await h.api<ApiError>('PATCH', '/learning/settings', { enabled: 'да' })).status, 400)
		await new Promise<void>(r2 => setTimeout(r2, 20))
		fs.writeFileSync(file, JSON.stringify({ enabled: true, maxAgents: 1 }))
		h.orch.learning?.tick()
		const v = await h.api<LearningView>('GET', '/learning')
		assert.equal(v.body.settings.enabled, true)
		assert.equal(v.body.settings.maxAgents, 1)
	})

	it('удаление кейса убирает каталог; нет кейса/задания — 404', T, async () => {
		scenarios({ 'SESSION COLLECTOR': [{ text: REPLY }] })
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const s = await work(h)
		await h.api('POST', `/sessions/${s.id}/closed`)
		const learning = h.orch.learning
		assert.ok(learning)
		await until(() => learning.view().cases.some(c => c.status === 'ready'), 40000, 'кейс ready')
		const id = `c-${s.id}`
		const detail = await h.api<CaseDetail>('GET', `/learning/cases/${id}`)
		assert.equal(detail.status, 200)
		assert.match(detail.body.summary, /# T/)
		const dir = path.join(h.home, 'cases', id)
		assert.ok(fs.existsSync(dir))
		assert.equal((await h.api('DELETE', `/learning/cases/${id}`)).status, 200)
		assert.ok(!fs.existsSync(dir))
		const gone = await h.api<ApiError>('GET', `/learning/cases/${id}`)
		assert.equal(gone.status, 404)
		assert.equal(gone.body.code, 'no_case')
		assert.equal((await h.api<ApiError>('POST', '/learning/jobs/j-none/retry', {})).body.code, 'no_job')
	})

	it('разбор прошлых сессий: транскрипт из CLAUDE_PROJECTS_DIR → кейс ready; CLI case ls / learn off --session', T, async () => {
		scenarios({ 'SESSION COLLECTOR': [{ text: REPLY }] })
		const projects = path.join(base, 'projects')
		fs.mkdirSync(path.join(projects, 'p1'), { recursive: true })
		const rec = (o: unknown): string => JSON.stringify(o)
		fs.writeFileSync(
			path.join(projects, 'p1', 'chat-old.jsonl'),
			[
				rec({ type: 'user', uuid: 'u1', timestamp: '2026-09-01T10:00:00Z', message: { role: 'user', content: 'разбери репозиторий' } }),
				rec({ type: 'assistant', uuid: 'a1', timestamp: '2026-09-01T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'nessy-orch spawn --role code-explorer "найди"' } }] } }),
			].join('\n') + '\n',
		)
		h = await startHarness({ base, config: { learningDefaultOn: false, claudeProjectsDir: projects } })
		const list = await h.api<BackfillCandidate[]>('GET', '/learning/backfill')
		assert.equal(list.body.length, 1)
		assert.equal(list.body[0]?.id, 'chat-old')
		assert.equal(list.body[0].title, 'разбери репозиторий')
		const r = await h.api<BackfillResult>('POST', '/learning/backfill', { ids: ['chat-old'] })
		assert.equal(r.status, 200)
		assert.equal(r.body.created[0]?.id, 'c-t-chat-old')
		const learning = h.orch.learning
		assert.ok(learning)
		await until(() => learning.view().cases.some(c => c.status === 'ready'), 40000, 'кейс разбора ready')
		assert.match(fs.readFileSync(path.join(h.home, 'cases', 'c-t-chat-old', 'summary.md'), 'utf8'), /# T/)
		assert.equal((await h.api<BackfillCandidate[]>('GET', '/learning/backfill')).body.length, 0)
		const again = await h.api<BackfillResult>('POST', '/learning/backfill', { ids: ['chat-old'] })
		assert.equal(again.body.created.length, 0)
		assert.equal((await h.api<ApiError>('POST', '/learning/backfill', { ids: ['нет'] })).status, 404)

		const ls = await cli(h, 'case', 'ls')
		assert.equal(ls.code, 0)
		assert.match(ls.out, /c-t-chat-old/)
		assert.match(ls.out, /ready/)
		const show = await cli(h, 'case', 'show', 'c-t-chat-old')
		assert.match(show.out, /# T/)
		const off = await cli(h, 'learn', 'off', '--session', 'S1')
		assert.equal(off.code, 0)
		assert.deepEqual((await h.api<LearningView>('GET', '/learning')).body.settings.disabledSessions, ['S1'])
		const on = await cli(h, 'learn', 'on', '--session', 'S1')
		assert.equal(on.code, 0)
		assert.deepEqual((await h.api<LearningView>('GET', '/learning')).body.settings.disabledSessions, [])
		const status = await cli(h, 'learn')
		assert.match(status.out, /обучение/)
		assert.match(status.out, /c-t-chat-old/)
		assert.equal((await cli(h, 'learn', '--json')).code, 0)
	})

	it('изменения без токена оператора — 403, чтение открыто', T, async () => {
		const TOKEN = 'operator-token-0123456789abcdef0123456789'
		h = await startHarness({ base, config: { authToken: TOKEN, authRequired: true } })
		assert.equal((await h.api('GET', '/learning')).status, 200)
		const writes: Array<[string, string]> = [
			['PATCH', '/learning/settings'],
			['POST', '/learning/run'],
			['POST', '/learning/backfill'],
			['POST', '/learning/jobs/j1/retry'],
			['POST', '/learning/cases/c1/rebuild'],
			['DELETE', '/learning/cases/c1'],
		]
		for (const [method, p] of writes) {
			const r: { status: number; body: ApiError } = await h.api<ApiError>(method, p, method === 'DELETE' ? undefined : {})
			assert.equal(r.status, 403, `${method} ${p}`)
			assert.equal(r.body.code, 'operator_required')
		}
		assert.equal((await h.api('POST', '/learning/run', {}, { 'X-Orch-Token': TOKEN })).status, 200)
	})
})
