/** Архив и прерывание: авто-архив после хода, пробуждение сообщением, ручной archive/restore, interrupt и --queue. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { AgentView, ApiError, GraphView, Message, SendResponse, SpawnResponse, UserEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 25000 }
const CLI = path.resolve(__dirname, '..', '..', '..', 'bin', 'nessy-orch')

describe('архив и прерывание', () => {
	let h: Harness
	const msgs = (): Message[] => h.orch.listMessages({ limit: 1000 })
	const users = (ref: string): string[] =>
		h.orch
			.agentHistory(ref, 1000)
			.filter((e): e is UserEvent => e.kind === 'user')
			.map(e => e.text)
	const cli = (...args: string[]): Promise<string> =>
		new Promise((resolve, reject) => {
			execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ORCH_PORT: String(h.port), NO_COLOR: '1' } }, (err, stdout, stderr) => {
				if (err) reject(new Error(`${err.message}\n${stderr}`))
				else resolve(stdout + stderr)
			})
		})

	before(async () => {
		h = await startHarness()
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
	})
	after(() => h.close())

	it('агент без задачи виден (idle, не в архиве); успешный ход уводит в архив, граф его по-прежнему отдаёт', T, async () => {
		const idle = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'spare' })
		await until(() => h.orch.getAgent('spare').status === 'idle', 8000, 'spare подключён')
		assert.equal(idle.body.agent.archived, false)
		assert.equal(h.orch.getAgent('spare').archived, false)

		const r = await h.api<SpawnResponse>('POST', '/agents', { space: 'main', name: 'done', prompt: 'сделай', wait: true })
		assert.equal(r.body.reply?.text, 'ответ: сделай')
		const a = h.orch.getAgent('done')
		assert.equal(a.status, 'idle')
		assert.equal(a.archived, true)
		const g = await h.api<GraphView>('GET', '/graph')
		assert.ok(g.body.agents.some(x => x.name === 'done' && x.archived), 'архивные агенты остаются в графе')
	})

	it('сообщение агенту в архиве будит его в той же сессии nessy', T, async () => {
		const session = h.orch.resolveAgent('done').sessionId
		const seen: boolean[] = []
		const unsub = h.orch.hub.subscribe(e => {
			if (e.t === 'agent' && e.agent.name === 'done') seen.push(e.agent.archived)
		})
		const r = await h.api<SendResponse>('POST', '/agents/done/send', { text: 'продолжи', wait: true, waitTimeoutSec: 10 })
		unsub()
		assert.equal(r.body.reply?.text, 'ответ: продолжи')
		assert.equal(h.orch.resolveAgent('done').sessionId, session, 'сессия прежняя')
		assert.ok(seen.includes(false), 'на время работы агент выходил из архива')
		assert.equal(h.orch.getAgent('done').archived, true, 'и вернулся в архив')
		assert.ok(!h.orch.agentHistory('done').some(e => e.kind === 'system' && /контекст сброшен/.test(e.text)))
	})

	it('ручные archive/restore; archive работающего агента → 409 busy', T, async () => {
		const restored = await h.api<AgentView>('POST', '/agents/done/restore', {})
		assert.equal(restored.status, 200)
		assert.equal(restored.body.archived, false)
		const archived = await h.api<AgentView>('POST', '/agents/done/archive', {})
		assert.equal(archived.status, 200)
		assert.equal(archived.body.archived, true)
		assert.equal((await h.api<ApiError>('POST', '/agents/nope/archive', {})).status, 404)

		await h.api('POST', '/agents/done/send', { text: '#slow' })
		await until(() => h.orch.getAgent('done').status === 'working', 4000, 'working')
		assert.equal(h.orch.getAgent('done').archived, false)
		const busy = await h.api<ApiError>('POST', '/agents/done/archive', {})
		assert.equal(busy.status, 409)
		assert.equal(busy.body.code, 'busy')
		await until(() => h.orch.getAgent('done').archived, 6000, 'архив после хода')
	})

	it('сообщение от you прерывает ход: ожидавший получает «(ход прерван)», срочное идёт раньше очереди', T, async () => {
		const slow = h.api<SendResponse>('POST', '/agents/done/send', { text: '#slow', wait: true, waitTimeoutSec: 10 })
		await until(() => h.orch.getAgent('done').status === 'working', 4000, 'working')
		await h.api('POST', '/agents/done/send', { text: 'потом', interrupt: false })
		const urgent = await h.api<SendResponse>('POST', '/agents/done/send', { text: 'срочно', wait: true, waitTimeoutSec: 10 })
		assert.equal(urgent.body.reply?.text, 'ответ: срочно')
		const old = await slow
		assert.match(old.body.reply?.text ?? '', /\(ход прерван\)$/)
		await until(() => msgs().some(m => m.kind === 'reply' && m.text === 'ответ: потом'), 8000, 'очередь доставлена')
		assert.deepEqual(users('done').slice(-3), ['#slow', 'срочно', 'потом'])
		assert.ok(h.orch.agentHistory('done').some(e => e.kind === 'system' && e.text === 'ход прерван'))
	})

	it('сообщение агента агенту не прерывает ход', T, async () => {
		const spare = h.orch.resolveAgent('spare').id
		const slow = h.api<SendResponse>('POST', '/agents/done/send', { text: '#slow', wait: true, waitTimeoutSec: 10 })
		await until(() => h.orch.getAgent('done').status === 'working', 4000, 'working')
		await h.api('POST', '/agents/done/send', { from: spare, text: 'от коллеги' })
		assert.equal(h.orch.getAgent('done').queued, 1)
		assert.equal((await slow).body.reply?.text, 'медленный ответ')
		await until(() => users('done').at(-1) === 'от коллеги', 8000, 'доставлено после хода')
		// ответ done уходит spare промптом — spare просыпается, отрабатывает и снова уходит в архив
		await until(() => users('spare').some(t => t === 'ответ: от коллеги'), 8000, 'ответ коллеге')
	})

	it('CLI send --queue не прерывает, без флага — прерывает', T, async () => {
		await until(() => h.orch.getAgent('done').status === 'idle', 8000, 'idle')
		const slow = h.api<SendResponse>('POST', '/agents/done/send', { text: '#slow', wait: true, waitTimeoutSec: 10 })
		await until(() => h.orch.getAgent('done').status === 'working', 4000, 'working')
		await cli('send', 'done', '--queue', 'в очередь из cli')
		assert.equal(h.orch.getAgent('done').queued, 1)
		assert.equal((await slow).body.reply?.text, 'медленный ответ', 'ход не прерван')
		await until(() => h.orch.getAgent('done').status === 'idle', 8000, 'очередь отработана')

		const slow2 = h.api<SendResponse>('POST', '/agents/done/send', { text: '#slow', wait: true, waitTimeoutSec: 10 })
		await until(() => h.orch.getAgent('done').status === 'working', 4000, 'working')
		await cli('send', 'done', 'срочно из cli')
		assert.match((await slow2).body.reply?.text ?? '', /\(ход прерван\)$/)
		await until(() => msgs().some(m => m.kind === 'reply' && m.text === 'ответ: срочно из cli'), 8000, 'ответ на срочное')
	})

	it('CLI ls скрывает архивных, ls --all показывает', T, async () => {
		await until(() => h.orch.getAgent('done').archived, 8000, 'done в архиве')
		await h.api('POST', '/agents', { space: 'main', name: 'fresh' })
		const ls = await cli('ls')
		assert.match(ls, /fresh/)
		assert.doesNotMatch(ls, /\bdone\b/)
		assert.match(ls, /в архиве: \d+/)
		const all = await cli('ls', '--all')
		assert.match(all, /done/)
		assert.match(all, /архив/)
	})
})
