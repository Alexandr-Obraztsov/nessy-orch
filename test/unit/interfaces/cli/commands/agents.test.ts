import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../../src/interfaces/cli/dispatch'
import { CliError } from '../../../../../src/interfaces/cli/errors'
import { agent, baseAgent, mockTransport, opts } from '../../../../support/cli-helper'
import type { GraphView, SpawnResponse, WaitResponse } from '../../../../../shared/types'

const graph = (agentsList: (typeof baseAgent)[]): GraphView => ({ rev: 1, spaces: [], roles: [], sessions: [], agents: agentsList })

const msg = { seq: 1, id: 'm1', ts: 1, from: 'you', to: 'a-1', kind: 'msg' as const, text: 'ответ', hops: 0 }

function spawnResp(over: Partial<SpawnResponse> = {}): SpawnResponse {
	return { agent: baseAgent, message: msg, ...over }
}

function waitResp(over: Partial<WaitResponse> = {}): WaitResponse {
	return { done: true, agent: baseAgent, ...over }
}

describe('CLI agents: ls', () => {
	it('ls — GET /graph, дерево в stdout', async () => {
		const { t, calls } = mockTransport({ '/graph': () => graph([baseAgent]) })
		const o = opts()
		await runCommand(['ls'], t, o)
		assert.equal(calls[0]?.path, '/graph')
		assert.match(o.stdout.join('\n'), /a-1/)
	})

	it('ls --json — массив без архива', async () => {
		const { t } = mockTransport({ '/graph': () => graph([baseAgent, agent({ id: 'a-arch', parent: 'you', archived: true })]) })
		const o = opts()
		await runCommand(['ls', '--json'], t, o)
		const list = JSON.parse(o.stdout[0] ?? '[]') as Array<{ id: string }>
		assert.equal(list.length, 1)
		assert.equal(list[0]?.id, 'a-1')
	})

	it('ls — пусто: подсказка в stdout', async () => {
		const { t } = mockTransport({ '/graph': () => graph([]) })
		const o = opts()
		await runCommand(['ls'], t, o)
		assert.match(o.stdout.join('\n'), /активных агентов нет/)
	})

	it('ls --all — с архивом', async () => {
		const { t } = mockTransport({
			'/graph': () => graph([baseAgent, agent({ id: 'a-arch', parent: 'you', archived: true })]),
		})
		const o = opts()
		await runCommand(['ls', '--all'], t, o)
		assert.match(o.stdout.join('\n'), /a-arch/)
	})

	it('ls без --all — счётчик архива в stderr', async () => {
		const { t } = mockTransport({
			'/graph': () => graph([baseAgent, agent({ id: 'a-arch', parent: 'you', archived: true })]),
		})
		const o = opts()
		await runCommand(['ls'], t, o)
		assert.match(o.stderr.join('\n'), /в архиве/)
	})

	it('ls --session — фильтр по сессии', async () => {
		const { t, calls } = mockTransport({
			'/graph': () => graph([agent({ id: 'a-s', parent: 'you', session: 's1' }), agent({ id: 'a-x', parent: 'you', session: 's2' })]),
		})
		const o = opts()
		await runCommand(['ls', '--session', 's1'], t, o)
		assert.match(o.stdout.join('\n'), /a-s/)
		assert.ok(!o.stdout.join('\n').includes('a-x'))
		assert.equal(calls[0]?.path, '/graph')
	})

	it('активный агент с архивным родителем не показывается корнем без --all', async () => {
		const { t } = mockTransport({
			'/graph': () => graph([agent({ id: 'child', parent: 'arch-parent', session: null }), agent({ id: 'arch-parent', parent: 'you', archived: true })]),
		})
		const o = opts()
		await runCommand(['ls'], t, o)
		const out = o.stdout.join('\n')
		assert.ok(!out.includes('child'), 'без --all активный агент под архивным родителем не должен быть корнем')
	})
})

describe('CLI agents: spawn', () => {
	it('spawn --no-wait — POST /agents, тело с runtime/model/from', async () => {
		const { t, calls } = mockTransport({ '/agents': () => spawnResp() })
		const o = opts()
		await runCommand(['spawn', '--no-wait', '--runtime', 'tclaude', '--model', 'sonnet', '--from', 'a-1', '--key', 'k', 'задача'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(body['runtime'], 'tclaude')
		assert.equal(body['model'], 'sonnet')
		assert.equal(body['from'], 'a-1')
		assert.equal(body['wait'], false)
		assert.match(o.stderr.join('\n'), /a-1/)
		assert.match(o.stderr.join('\n'), /отправлено/)
	})

	it('spawn --wait без текста — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['spawn', '--wait'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('spawn --wait — ждёт через GET /agents/:id/wait', async () => {
		const { t, calls } = mockTransport({
			'/agents': () => spawnResp(),
			'/agents/a-1/wait?timeout=1500': () => waitResp({ reply: { ...msg, text: 'готово' } }),
		})
		const o = opts()
		await runCommand(['spawn', '--wait', 'задача'], t, o)
		assert.match(o.stdout.join('\n'), /готово/)
		assert.ok(calls.some(c => c.path.includes('/wait')))
	})

	it('spawn --wait --json — JSON-ответ', async () => {
		const { t } = mockTransport({
			'/agents': () => spawnResp(),
			'/agents/a-1/wait?timeout=1500': () => waitResp({ reply: { ...msg, text: 'готово' } }),
		})
		const o = opts()
		await runCommand(['spawn', '--wait', '--json', 'задача'], t, o)
		const parsed = JSON.parse(o.stdout[0] ?? '{}') as { agent: unknown }
		assert.ok(parsed.agent)
	})

	it('spawn неверный --runtime — CliError', async () => {
		const { t } = mockTransport({})
		await assert.rejects(() => runCommand(['spawn', '--runtime', 'nope', 'задача'], t, opts()), /неизвестный рантайм/)
	})
})

describe('CLI agents: wait', () => {
	it('wait без аргумента — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['wait'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('wait — ответ агента в stdout', async () => {
		const { t, calls } = mockTransport({ '/agents/a-1/wait?timeout=1500': () => waitResp({ reply: { ...msg, text: 'готово' } }) })
		const o = opts()
		await runCommand(['wait', 'a-1'], t, o)
		assert.match(calls[0]?.path ?? '', /\/wait\?timeout=1500/)
		assert.match(o.stdout.join('\n'), /готово/)
	})

	it('wait --json — сырой ответ', async () => {
		const { t } = mockTransport({ '/agents/a-1/wait?timeout=1500': () => waitResp({ reply: { ...msg, text: 'готово' } }) })
		const o = opts()
		await runCommand(['wait', '--json', 'a-1'], t, o)
		assert.equal((JSON.parse(o.stdout[0] ?? '{}') as { done: boolean }).done, true)
	})

	it('wait не done — CliError 3 (ещё работает)', async () => {
		const { t } = mockTransport({ '/agents/a-1/wait?timeout=1500': () => waitResp({ done: false }) })
		await assert.rejects(
			() => runCommand(['wait', 'a-1'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 3,
		)
	})

	it('wait без reply — свободен, ничего не отвечал', async () => {
		const { t } = mockTransport({ '/agents/a-1/wait?timeout=1500': () => waitResp() })
		const o = opts()
		await runCommand(['wait', 'a-1'], t, o)
		assert.match(o.stderr.join('\n'), /свободен/)
	})

	it('wait c failed-ответом — красное сообщение в stderr', async () => {
		const { t } = mockTransport({
			'/agents/a-1/wait?timeout=1500': () => waitResp({ reply: { ...msg, text: '', failed: 'упало' } }),
		})
		const o = opts()
		await runCommand(['wait', 'a-1'], t, o)
		assert.match(o.stderr.join('\n'), /упало/)
	})
})

describe('CLI agents: send', () => {
	it('send без текста — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['send', 'a-1'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('send — POST /agents/:ref/send с телом', async () => {
		const { t, calls } = mockTransport({ '/agents/a-1/send': () => ({ message: msg }) })
		const o = opts()
		await runCommand(['send', 'a-1', '--no-wait', 'привет'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(calls[0]?.path, '/agents/a-1/send')
		assert.equal(body['text'], 'привет')
		assert.match(o.stderr.join('\n'), /отправлено/)
	})

	it('send с ответом — reply в stdout', async () => {
		const { t } = mockTransport({ '/agents/a-1/send': () => ({ message: msg, reply: { ...msg, text: 'ок' } }) })
		const o = opts()
		await runCommand(['send', 'a-1', 'привет'], t, o)
		assert.match(o.stdout.join('\n'), /ок/)
	})

	it('send --from --key — from в теле, ключ до транспорта', async () => {
		const { t, calls, keys } = mockTransport({ '/agents/a-1/send': () => ({ message: msg }) })
		await runCommand(['send', 'a-1', '--no-wait', '--from', 'a-1', '--key', 'secret', 'привет'], t, opts())
		assert.equal((calls[0]?.body as Record<string, unknown>)['from'], 'a-1')
		assert.deepEqual(keys, ['secret'])
	})

	it('send timedOut — CliError 3', async () => {
		const { t } = mockTransport({ '/agents/a-1/send': () => ({ message: msg, timedOut: true }) })
		await assert.rejects(
			() => runCommand(['send', 'a-1', 'привет'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 3,
		)
	})

	it('send --json — JSON', async () => {
		const { t } = mockTransport({ '/agents/a-1/send': () => ({ message: msg }) })
		const o = opts()
		await runCommand(['send', '--json', 'a-1', '--no-wait', 'привет'], t, o)
		assert.ok((JSON.parse(o.stdout[0] ?? '{}') as { message: unknown }).message)
	})
})
