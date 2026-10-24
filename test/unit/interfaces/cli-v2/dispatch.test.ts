import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../src/interfaces/cli-v2/dispatch'
import { CliError } from '../../../../src/interfaces/cli/errors'
import type { Transport } from '../../../../src/interfaces/cli-v2/transport'
import type { AgentView, GraphView, SpawnResponse } from '../../../../shared/types'

const baseAgent: AgentView = {
	id: 'a-1',
	name: 'a-1',
	title: null,
	space: 'ws',
	session: null,
	parent: 'you',
	role: null,
	status: 'idle',
	archived: false,
	parked: false,
	error: null,
	displayName: null,
	createdAt: '',
	lastActivityAt: '',
	queued: 0,
	turnStartedAt: null,
	lastTool: null,
	preview: '',
	pendingPermissions: [],
	plan: null,
	turnSteps: 0,
	lastTurnMs: null,
	lastReply: null,
	stats: { turns: 0, toolCalls: 0, workMs: 0, tokens: null, contextPct: null },
}

/** Запись запроса: метод + путь + тело. */
interface Req {
	method: string
	path: string
	body?: unknown
}

/** Мок HTTP-клиента: отвечает по правилам, накапливает запросы. */
function mockTransport(routes: Record<string, (method: string, body?: unknown) => unknown>): { t: Transport; calls: Req[]; keys: (string | undefined)[] } {
	const calls: Req[] = []
	const keys: (string | undefined)[] = []
	const t: Transport = {
		get<T>(path: string): Promise<T> {
			calls.push({ method: 'GET', path })
			const h = routes[path]
			return Promise.resolve(h ? (h('GET') as T) : (undefined as T))
		},
		post<T>(path: string, body?: unknown): Promise<T> {
			calls.push({ method: 'POST', path, body })
			const h = routes[path]
			return Promise.resolve(h ? (h('POST', body) as T) : (undefined as T))
		},
		patch<T>(path: string, body?: unknown): Promise<T> {
			calls.push({ method: 'PATCH', path, body })
			const h = routes[path]
			return Promise.resolve(h ? (h('PATCH', body) as T) : (undefined as T))
		},
		del(path: string): Promise<unknown> {
			calls.push({ method: 'DELETE', path })
			const h = routes[path]
			return Promise.resolve(h ? h('DELETE') : undefined)
		},
		setAgentKey(key?: string): void {
			keys.push(key)
		},
		sse(_path: string, _onData: (raw: unknown) => void) {
			return { done: Promise.resolve(), close: () => undefined }
		},
	}
	return { t, calls, keys }
}

/** Провайдер вывода: out — в stdout, info — в stderr. */
function opts() {
	const stdout: string[] = []
	const stderr: string[] = []
	return {
		cwd: '/ws',
		env: {},
		out: (s: string) => stdout.push(s),
		info: (s: string) => stderr.push(s),
		stdout,
		stderr,
	}
}

describe('cli-v2 dispatch', () => {
	it('help — справка в stdout', async () => {
		const { t } = mockTransport({})
		const o = opts()
		await runCommand(['--help'], t, o)
		assert.match(o.stdout[0] ?? '', /nessy-orch-v2/)
	})

	it('неизвестная команда — CliError с кодом 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['bogus'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('ls — GET /graph и дерево в stdout', async () => {
		const graph: GraphView = { rev: 1, spaces: [], roles: [], sessions: [], agents: [baseAgent] }
		const { t, calls } = mockTransport({ '/graph': () => graph })
		const o = opts()
		await runCommand(['ls'], t, o)
		assert.equal(calls.length, 1)
		assert.equal(calls[0]?.path, '/graph')
		assert.match(o.stdout.join('\n'), /a-1/)
	})

	it('spawn — POST /agents с runtime и model в теле', async () => {
		const resp: SpawnResponse = { agent: baseAgent, message: { seq: 1, id: 'm1', ts: 1, from: 'you', to: 'a-1', kind: 'msg', text: 'задача', hops: 0 } }
		const { t, calls } = mockTransport({ '/agents': () => resp })
		const o = opts()
		await runCommand(['spawn', '--no-wait', '--runtime', 'tclaude', '--model', 'sonnet', 'задача'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(body['runtime'], 'tclaude')
		assert.equal(body['model'], 'sonnet')
	})

	it('spawn с неверным --runtime — CliError', async () => {
		const { t } = mockTransport({})
		await assert.rejects(() => runCommand(['spawn', '--runtime', 'nope', 'задача'], t, opts()), /неизвестный рантайм/)
	})

	it('send — POST /agents/a-1/send с текстом', async () => {
		const resp = { message: { seq: 1, id: 'm1', ts: 1, from: 'you', to: 'a-1', kind: 'msg', text: 'привет', hops: 0 } }
		const { t, calls } = mockTransport({ '/agents/a-1/send': () => resp })
		const o = opts()
		await runCommand(['send', 'a-1', '--no-wait', 'привет'], t, o)
		const call = calls[0] as Req
		const body = call.body as Record<string, unknown>
		assert.equal(call.method, 'POST')
		assert.equal(call.path, '/agents/a-1/send')
		assert.equal(body['text'], 'привет')
	})

	it('send --from --key — ключ агента доходит до транспорта (setAgentKey)', async () => {
		const resp = { message: { seq: 1, id: 'm1', ts: 1, from: 'you', to: 'a-1', kind: 'msg', text: 'привет', hops: 0 } }
		const { t, calls, keys } = mockTransport({ '/agents/a-1/send': () => resp })
		await runCommand(['send', 'a-1', '--no-wait', '--from', 'a-1', '--key', 'secret', 'привет'], t, opts())
		assert.deepEqual(keys, ['secret'], '--key должен дойти до setAgentKey (заголовок X-Agent-Key)')
		assert.equal((calls[0]?.body as Record<string, unknown>)['from'], 'a-1')
	})

	it('status — GET /status', async () => {
		const { t, calls } = mockTransport({
			'/status': () => ({ version: '1', pid: 1, uptimeSec: 1, rev: 1, home: '/', autoApprove: false, spaces: 1, agents: 1, working: 0, roles: 1 }),
		})
		const o = opts()
		await runCommand(['status'], t, o)
		assert.equal(calls[0]?.path, '/status')
		assert.match(o.stdout.join('\n'), /nessy-orch/)
	})

	it('алиас agents → ls', async () => {
		const { t, calls } = mockTransport({ '/graph': () => ({ rev: 1, spaces: [], roles: [], sessions: [], agents: [baseAgent] }) })
		await runCommand(['agents'], t, opts())
		assert.equal(calls[0]?.path, '/graph')
	})
})
