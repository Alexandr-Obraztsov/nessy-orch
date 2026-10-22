/** Инструменты агента-сборщика: чтение блоков и черновик по ключу агента, CLI `case read` / `case draft`. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { ApiError, CaseDetail, CaseReadBlock, SessionView, SpawnResponse } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 60000 }
const TOKEN = 'operator-token-0123456789abcdef0123456789'
const op = { 'X-Orch-Token': TOKEN }
const CLI = path.join(__dirname, '..', '..', 'src', 'interfaces', 'cli', 'main.js')

describe('агент-сборщик: read и draft', () => {
	let h: Harness
	let caseId = ''
	let agentId = ''
	let agent: Record<string, string> = {}
	const cli = (input: string | null, ...args: string[]): Promise<{ code: number; out: string; err: string }> =>
		new Promise(resolve => {
			const child = execFile(
				process.execPath,
				[CLI, ...args],
				{ env: { ...process.env, ORCH_PORT: String(h.port), NO_COLOR: '1' } },
				(e, stdout, stderr) => resolve({ code: e ? 1 : 0, out: stdout, err: stderr }),
			)
			child.stdin?.end(input ?? '')
		})

	before(async () => {
		process.env['NESSY_ORCH_HOME'] = ''
		h = await startHarness({ autoRead: false, config: { authToken: TOKEN, authRequired: true, learningDefaultOn: true } })
		assert.equal((await h.api('POST', '/spaces', { path: h.ws, name: 'main' }, op)).status, 201)
		const s = (await h.api<SessionView>('POST', '/sessions', { title: 'Работа' }, op)).body
		const r = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'worker', session: s.id, prompt: 'сделай задачу', wait: true }, op)
		assert.equal(r.status, 201)
		caseId = `c-${s.id}`
		// сборщик «думает» бесконечно: задание остаётся идущим
		const fs = await import('node:fs')
		fs.writeFileSync(path.join(h.home, 'fake-scenarios.json'), JSON.stringify({ 'SESSION COLLECTOR': [{ hang: 'думаю' }] }))
		process.env['NESSY_ORCH_HOME'] = h.home
		assert.equal((await h.api('POST', `/sessions/${s.id}/closed`, {}, op)).status, 200)
		const learning = h.orch.learning
		assert.ok(learning)
		await until(() => learning.view().jobs.some(j => j.status === 'running' && j.agentId !== null), 20000, 'сборщик запущен')
		agentId = learning.view().jobs.find(j => j.status === 'running')?.agentId ?? ''
		agent = { 'X-Agent-Key': h.orch.resolveAgent(agentId).key }
	})
	after(() => h.close())

	it('GET read и POST draft доступны агенту по ключу; прочее меняющее — нет', T, async () => {
		const first = await h.api<CaseReadBlock>('GET', `/learning/cases/${caseId}/read?maxChars=100000`, undefined, agent)
		assert.equal(first.status, 200)
		assert.ok(first.body.total >= 2)
		assert.equal(first.body.done, true)
		assert.match(first.body.text, /^\[1\] /)
		const again = await h.api<CaseReadBlock>('GET', `/learning/cases/${caseId}/read`, undefined, agent)
		assert.equal(again.body.done, true)
		assert.equal(again.body.text, '')
		const d = await h.api('POST', `/learning/cases/${caseId}/draft`, { text: '# черновик', from: agentId }, agent)
		assert.equal(d.status, 200)
		const detail = (await h.api<CaseDetail>('GET', `/learning/cases/${caseId}`)).body
		assert.equal(detail.draft, '# черновик')
		assert.deepEqual(detail.progress, { read: first.body.total, total: first.body.total })
		const denied = await h.api<ApiError>('POST', `/learning/cases/${caseId}/rebuild`, {}, agent)
		assert.equal(denied.status, 403)
		// без from или с чужим ключом — отказ, чужой агент не сборщик
		assert.equal((await h.api<ApiError>('POST', `/learning/cases/${caseId}/draft`, { text: 'x' }, agent)).status, 403)
		assert.equal((await h.api<ApiError>('POST', `/learning/cases/${caseId}/draft`, { text: 'x', from: agentId }, { 'X-Agent-Key': 'wrong-key' })).status, 403)
		assert.equal((await h.api<ApiError>('GET', '/learning/cases/c-nope/read', undefined, agent)).status, 404)
	})

	it('задание в JobView: title = название сессии, progress; read до сброса указателя', T, async () => {
		const job = (await h.api<{ jobs: Array<{ status: string; title: string | null; progress: { read: number; total: number } | null }> }>('GET', '/learning')).body.jobs.find(j => j.status === 'running')
		assert.equal(job?.title, 'Работа')
		assert.ok(job.progress && job.progress.read === job.progress.total)
	})

	it('CLI: case draft из stdin, case read печатает блок и прогресс в stderr', T, async () => {
		const w = await cli('# из stdin', 'case', 'draft', caseId, '--from', agentId, '--key', agent['X-Agent-Key'] ?? '')
		assert.equal(w.code, 0, w.err)
		assert.equal((await h.api<CaseDetail>('GET', `/learning/cases/${caseId}`)).body.draft, '# из stdin')
		const r = await cli(null, 'case', 'read', caseId, '--max-chars', '500')
		assert.equal(r.code, 0, r.err)
		assert.equal(r.out.trim(), '')
		assert.match(r.err, /^done/)
	})
})
