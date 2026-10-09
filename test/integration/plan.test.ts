/** План агента через HTTP и CLI, ACP-план фейкового nessy (#plan), шаги/длительность/ответ и рестарт. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import type { AgentView, ApiError, SpawnResponse } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 30000 }
const CLI = path.resolve(__dirname, '..', '..', '..', 'bin', 'nessy-orch')

/** Запустить настоящий CLI против стенда. */
function cli(port: number, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise(resolve => {
		execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ORCH_PORT: String(port), NO_COLOR: '1' } }, (err, stdout, stderr) => {
			resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
		})
	})
}

describe('план агента: HTTP, CLI, ACP, рестарт', () => {
	let h: Harness | null = null
	let h2: Harness | null = null
	after(async () => {
		await h?.close({ keepFiles: true })
		await h2?.close()
	})

	it('POST/DELETE /agents/:ref/plan, CLI plan, ACP #plan и сохранение после рестарта', T, async () => {
		h = await startHarness()
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
		const a = (await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'planner', prompt: 'привет', wait: true })).body.agent.id
		const b = (await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'other' })).body.agent.id

		// HTTP
		const ok = await h.api<AgentView>('POST', `/agents/${a}/plan`, { from: a, entries: [{ content: 'шаг', status: 'in_progress' }] })
		assert.equal(ok.status, 200)
		assert.deepEqual(ok.body.plan?.entries, [{ content: 'шаг', status: 'in_progress' }])
		const forbidden = await h.api<ApiError>('POST', `/agents/${a}/plan`, { from: b, entries: [{ content: 'чужой', status: 'pending' }] })
		assert.equal(forbidden.status, 403)
		assert.equal(forbidden.body.code, 'forbidden')
		assert.equal((await h.api('POST', `/agents/${a}/plan`, { entries: [] })).status, 400)
		assert.equal((await h.api('POST', `/agents/${a}/plan`, { entries: [{ content: 'x', status: 'done' }] })).status, 400)
		assert.equal((await h.api('POST', `/agents/${a}/plan`, { from: a })).status, 400)
		assert.equal((await h.api('POST', '/agents/nope/plan', { entries: [{ content: 'x', status: 'pending' }] })).status, 404)
		assert.equal((await h.api('DELETE', `/agents/${a}/plan?from=${b}`)).status, 403)
		const cleared = await h.api<AgentView>('DELETE', `/agents/${a}/plan?from=${a}`)
		assert.equal(cleared.status, 200)
		assert.equal(cleared.body.plan, null)

		// CLI: агент публикует план, оператор смотрит
		const set = await cli(h.port, ['plan', '--from', a, '- [x] шаг 1', '- [~] шаг 2', '- [ ] шаг 3'])
		assert.equal(set.code, 0, set.stderr)
		assert.deepEqual(h.orch.getAgent(a).plan?.entries, [
			{ content: 'шаг 1', status: 'completed' },
			{ content: 'шаг 2', status: 'in_progress' },
			{ content: 'шаг 3', status: 'pending' },
		])
		assert.equal(h.orch.getAgent(a).plan?.source, 'cli')
		const show = await cli(h.port, ['plan', 'planner'])
		assert.equal(show.code, 0, show.stderr)
		assert.match(show.stdout, /\[x\] шаг 1\n\[~\] шаг 2\n\[ \] шаг 3/)
		const bad = await cli(h.port, ['plan', '--from', a, '- [x]   '])
		assert.notEqual(bad.code, 0, 'пустой пункт — ошибка')
		assert.equal(h.orch.getAgent(a).plan?.entries.length, 3, 'неверный план не применён')
		assert.equal((await cli(h.port, ['plan', '--from', a, '--clear'])).code, 0)
		assert.equal(h.orch.getAgent(a).plan, null)
		assert.match((await cli(h.port, ['plan', a])).stdout, /нет плана/)

		// ACP-план фейкового nessy: статусы продвигаются по ходу трёх инструментов
		const r = await h.api<SpawnResponse>('POST', `/agents/${a}/send`, { text: '#plan', wait: true, waitTimeoutSec: 15 })
		assert.match(r.body.reply?.text ?? '', /План выполнен/)
		assert.ok(!h.orch.agentHistory(a).some(e => e.kind === 'system' && e.text === 'агент не опубликовал план'), 'план есть — без предупреждения')
		const v = h.orch.getAgent(a)
		assert.equal(v.plan?.source, 'acp')
		assert.deepEqual(v.plan.entries.map(e => e.status), ['completed', 'completed', 'completed'])
		assert.equal(v.turnSteps, 3)
		assert.ok(v.lastTurnMs !== null && v.lastTurnMs > 0)
		assert.equal(v.lastReply?.msgId, r.body.reply?.id)
		assert.match(v.lastReply?.preview ?? '', /^План выполнен/)

		// рестарт: план, шаги, длительность и последний ответ сохраняются
		const base = h.base
		await h.close({ keepFiles: true })
		h = null
		h2 = await startHarness({ base })
		const after2 = h2.orch.getAgent('planner')
		assert.deepEqual(after2.plan, v.plan)
		assert.equal(after2.turnSteps, 3)
		assert.equal(after2.lastTurnMs, v.lastTurnMs)
		assert.deepEqual(after2.lastReply, v.lastReply)

		// новая задача от you после выполненного плана — план сброшен
		await h2.api('POST', '/agents/planner/send', { text: 'другое', wait: true, waitTimeoutSec: 15 })
		assert.equal(h2.orch.getAgent('planner').plan, null)
		assert.equal(h2.orch.getAgent('planner').turnSteps, 0)
	})
})
