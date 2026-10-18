/** Фоновое обучение, сборка в приложение: закрытие вкладки → служебный агент-сборщик → готовый кейс; рестарт посреди работы. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { AgentView, SessionView, SpawnResponse, StreamEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
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
		const agents = (await h.api<AgentView[]>('GET', '/agents')).body.filter(a => a.session === 'background')
		assert.equal(agents.length, 1)
		assert.equal(agents[0]?.archived, true)
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
})
