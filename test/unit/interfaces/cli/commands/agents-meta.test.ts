import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../../src/interfaces/cli/dispatch'
import { CliError } from '../../../../../src/interfaces/cli/errors'
import { baseAgent, mockTransport, opts } from '../../../../support/cli-helper'
import type { SpawnResponse } from '../../../../../shared/types'

const msg = { seq: 1, id: 'm1', ts: 1, from: 'you', to: 'a-1', kind: 'msg' as const, text: 'ответ', hops: 0 }

function spawnResp(over: Partial<SpawnResponse> = {}): SpawnResponse {
	return { agent: baseAgent, message: msg, ...over }
}

describe('CLI agents: ask', () => {
	it('ask без пространства/поручения — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['ask'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
		await assert.rejects(
			() => runCommand(['ask', 'ws'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('ask — POST /agents с from (проброс), wait=true, сессией', async () => {
		const { t, calls } = mockTransport({ '/agents': () => spawnResp({ reply: { ...msg, text: 'готово' } }) })
		const o = opts()
		await runCommand(['ask', 'ws', '--from', 'a-1', '--session', 's1', 'сделай'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(calls[0]?.path, '/agents')
		assert.equal(body['from'], 'a-1', 'from должен пробрасываться в тело POST /agents')
		assert.equal(body['session'], 's1')
		assert.equal(body['wait'], true)
		assert.match(o.stdout.join('\n'), /готово/)
	})

	it('ask --json', async () => {
		const { t } = mockTransport({ '/agents': () => spawnResp() })
		const o = opts()
		await runCommand(['ask', '--json', 'ws', 'сделай'], t, o)
		assert.ok((JSON.parse(o.stdout[0] ?? '{}') as { agent: unknown }).agent)
	})
})

describe('CLI agents: show/plan/cancel', () => {
	it('show без аргумента — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['show'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('show — агент и события', async () => {
		const { t, calls } = mockTransport({
			'/agents/a-1': () => baseAgent,
			'/agents/a-1/history?limit=40': () => [{ seq: 1, id: 'e1', ts: 1, type: 'message', text: 'привет', failed: false }],
		})
		const o = opts()
		await runCommand(['show', 'a-1'], t, o)
		assert.match(o.stdout.join('\n'), /a-1/)
		assert.ok(calls.some(c => c.path.includes('/history')))
	})

	it('show --json', async () => {
		const { t } = mockTransport({
			'/agents/a-1': () => baseAgent,
			'/agents/a-1/history?limit=40': () => [],
		})
		const o = opts()
		await runCommand(['show', '--json', 'a-1'], t, o)
		assert.ok((JSON.parse(o.stdout[0] ?? '{}') as { agent: unknown }).agent)
	})

	it('plan без ref — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['plan'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('plan — публикация пунктов POST /plan', async () => {
		const { t, calls } = mockTransport({ '/agents/a-1/plan': () => ({ ...baseAgent, plan: { entries: [] } }) })
		const o = opts()
		await runCommand(['plan', 'a-1', '--from', 'a-1', '"- [x] шаг"'], t, o)
		const call = calls[0] as { method: string; path: string; body: Record<string, unknown> }
		assert.equal(call.path, '/agents/a-1/plan')
		assert.equal(call.method, 'POST')
		assert.equal(call.body['from'], 'a-1')
		assert.ok(Array.isArray(call.body['entries']))
	})

	it('plan --clear — DELETE плана', async () => {
		const { t, calls } = mockTransport({
			'/agents/a-1/plan?from=a-1': () => undefined,
			'/agents/a-1': () => baseAgent,
		})
		const o = opts()
		await runCommand(['plan', '--clear', '--from', 'a-1'], t, o)
		assert.ok(calls.some(c => c.method === 'DELETE'))
		assert.match(o.stdout.join('\n'), /нет плана/)
	})

	it('plan — показать план, если есть', async () => {
		const { t } = mockTransport({ '/agents/a-1': () => ({ ...baseAgent, plan: { entries: [{ content: 'шаг', status: 'pending' }] } }) })
		const o = opts()
		await runCommand(['plan', 'a-1'], t, o)
		assert.match(o.stdout.join('\n'), /шаг/)
	})

	it('cancel без аргумента — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['cancel'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('cancel — POST /agents/:ref/cancel', async () => {
		const { t, calls } = mockTransport({ '/agents/a-1/cancel': () => ({ ...baseAgent, status: 'idle' }) })
		const o = opts()
		await runCommand(['cancel', 'a-1'], t, o)
		assert.equal(calls[0]?.path, '/agents/a-1/cancel')
		assert.match(o.stdout.join('\n'), /прервано/)
	})
})

describe('CLI agents: kill/archive/restore', () => {
	it('kill — DELETE /agents/:ref; без аргумента — CliError 2', async () => {
		const { t, calls } = mockTransport({})
		const o = opts()
		await runCommand(['kill', 'a-1'], t, o)
		assert.deepEqual(calls[0], { method: 'DELETE', path: '/agents/a-1' })
		assert.match(o.stdout.join('\n'), /удалён/)
		await assert.rejects(
			() => runCommand(['kill'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('archive / restore — POST /agents/:ref/<действие>', async () => {
		const { t, calls } = mockTransport({ '/agents/a-1/archive': () => baseAgent, '/agents/a-1/restore': () => baseAgent })
		const o = opts()
		await runCommand(['archive', 'a-1'], t, o)
		await runCommand(['restore', 'a-1'], t, o)
		assert.deepEqual(
			calls.map(c => c.path),
			['/agents/a-1/archive', '/agents/a-1/restore'],
		)
		assert.match(o.stdout.join('\n'), /в архиве/)
	})
})

describe('CLI agents: model / runtime ls', () => {
	it('model <агент> <модель> — POST /agents/:ref/model', async () => {
		const { t, calls } = mockTransport({ '/agents/a-1/model': () => ({ ...baseAgent, runtime: 'tclaude', model: 'opus' }) })
		const o = opts()
		await runCommand(['model', 'a-1', 'opus'], t, o)
		assert.equal(calls[0]?.method, 'POST')
		assert.deepEqual(calls[0]?.body, { model: 'opus' })
		assert.match(o.stdout.join('\n'), /tclaude · opus/)
	})

	it('model без модели — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['model', 'a-1'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('model: ошибка сервера (409) пробрасывается', async () => {
		const { t } = mockTransport({
			'/agents/a-1/model': () => {
				throw new CliError('model_switch_unsupported', 1)
			},
		})
		await assert.rejects(() => runCommand(['model', 'a-1', 'opus'], t, opts()), /model_switch_unsupported/)
	})

	it('runtime ls — таблица из GET /runtimes', async () => {
		const info = {
			id: 'tclaude',
			label: 'tclaude',
			defaultModel: 'sonnet',
			models: [{ id: 'sonnet', label: 'Sonnet' }],
			capabilities: { setModel: true, midTurn: false, permissionVote: false, streamText: true },
			available: true,
		}
		const { t, calls } = mockTransport({ '/runtimes': () => [info] })
		const o = opts()
		await runCommand(['runtime', 'ls'], t, o)
		assert.equal(calls[0]?.path, '/runtimes')
		const out = o.stdout.join('\n')
		assert.match(out, /tclaude/)
		assert.match(out, /sonnet/)
		assert.match(out, /setModel, streamText/)
	})

	it('runtime foo — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['runtime', 'foo'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('show и ls: запрошенная модель помечена', async () => {
		const a = { ...baseAgent, runtime: 'tclaude' as const, model: 'sonnet', modelRequested: 'opus' }
		const { t } = mockTransport({ '/agents/a-1': () => a, '/agents/a-1/history?limit=40': () => [], '/graph': () => ({ rev: 1, spaces: [], roles: [], sessions: [], agents: [a] }) })
		const o = opts()
		await runCommand(['show', 'a-1'], t, o)
		await runCommand(['ls'], t, o)
		const out = o.stdout.join('\n')
		assert.equal((out.match(/запрошено opus/g) ?? []).length, 2)
	})
})
