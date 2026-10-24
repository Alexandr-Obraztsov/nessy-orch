import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../../src/interfaces/cli-v2/dispatch'
import type { Transport } from '../../../../../src/interfaces/cli-v2/transport'
import { agent, mockTransport, opts } from '../../../../support/cli-v2-helper'
import type { GraphView, Message } from '../../../../../shared/types'

const graph = (): GraphView => ({ rev: 1, spaces: [], roles: [], sessions: [], agents: [agent({ id: 'a-1' })] })

const msg: Message = { seq: 1, id: 'm1', ts: 1000, from: 'you', to: 'a-1', kind: 'msg', text: 'привет', hops: 0 }

/** Транспорт, чей sse сразу доставляет один кадр (для --follow). */
function followTransport(frame: unknown): { t: Transport; calls: { method: string; path: string }[] } {
	const calls: { method: string; path: string }[] = []
	let cb: ((raw: unknown) => void) | null = null
	const noop = <T>(): Promise<T> => Promise.resolve(undefined as T)
	const t: Transport = {
		get<T>(path: string): Promise<T> {
			calls.push({ method: 'GET', path })
			if (path === '/graph') return Promise.resolve(graph() as T)
			if (path.startsWith('/messages')) return Promise.resolve([msg] as T)
			return Promise.resolve(undefined as T)
		},
		post: noop,
		patch: noop,
		del: noop,
		setAgentKey: () => undefined,
		sse(_path: string, onData: (raw: unknown) => void) {
			cb = onData
			return {
				done: Promise.resolve().then(() => {
					cb?.(frame)
				}),
				close: () => undefined,
			}
		},
	}
	return { t, calls }
}

describe('cli-v2 feed', () => {
	it('feed — GET /graph и /messages, сообщения в stdout', async () => {
		const { t, calls } = mockTransport({
			'/graph': () => graph(),
			'/messages?limit=30': () => [msg],
		})
		const o = opts()
		await runCommand(['feed'], t, o)
		assert.ok(calls.some(c => c.path === '/graph'))
		assert.ok(calls.some(c => c.path === '/messages?limit=30'))
		assert.match(o.stdout.join('\n'), /привет/)
	})

	it('feed -n 5 — limit из флага', async () => {
		const { t, calls } = mockTransport({ '/graph': () => graph(), '/messages?limit=5': () => [msg] })
		await runCommand(['feed', '-n', '5'], t, opts())
		assert.ok(calls.some(c => c.path === '/messages?limit=5'))
	})

	it('feed --json — массив сообщений', async () => {
		const { t } = mockTransport({ '/graph': () => graph(), '/messages?limit=30': () => [msg] })
		const o = opts()
		await runCommand(['feed', '--json'], t, o)
		const list = JSON.parse(o.stdout[0] ?? '[]') as Message[]
		assert.equal(list[0]?.text, 'привет')
	})

	it('feed --json --follow — SSE-кадры как JSON', async () => {
		const { t } = followTransport({ t: 'message', message: { from: 'you', to: 'a-1', kind: 'msg', text: 'стрим' } })
		const o = opts()
		await runCommand(['feed', '--json', '--follow'], t, o)
		assert.match(o.stdout.join('\n'), /стрим/)
	})

	it('feed --follow — SSE-кадры рендерятся', async () => {
		const { t } = followTransport({ t: 'message', message: { from: 'you', to: 'a-1', kind: 'msg', text: 'стрим' } })
		const o = opts()
		await runCommand(['feed', '--follow'], t, o)
		assert.match(o.stdout.join('\n'), /стрим/)
	})

	it('feed пустая лента — ничего в stdout', async () => {
		const { t } = mockTransport({ '/graph': () => graph(), '/messages?limit=30': () => [] })
		const o = opts()
		await runCommand(['feed'], t, o)
		assert.equal(o.stdout.length, 0)
	})
})
