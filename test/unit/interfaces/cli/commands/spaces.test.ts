import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../../src/interfaces/cli/dispatch'
import { CliError } from '../../../../../src/interfaces/cli/errors'
import { mockTransport, opts } from '../../../../support/cli-helper'
import type { GraphView, SpaceView } from '../../../../../shared/types'

const space: SpaceView = { name: 'ws', path: '/ws', mode: 'managed', status: 'ready', error: null, color: 210, url: null }
const graph = (spaces: SpaceView[]): GraphView => ({ rev: 1, agents: [], roles: [], sessions: [], spaces })

describe('CLI space', () => {
	it('space ls — список пространств', async () => {
		const { t, calls } = mockTransport({ '/graph': () => graph([space]) })
		const o = opts()
		await runCommand(['space', 'ls'], t, o)
		assert.equal(calls[0]?.path, '/graph')
		assert.match(o.stdout.join('\n'), /ws/)
	})

	it('space (без подкоманды) — ls', async () => {
		const { t } = mockTransport({ '/graph': () => graph([space]) })
		const o = opts()
		await runCommand(['space'], t, o)
		assert.match(o.stdout.join('\n'), /ws/)
	})

	it('space ls пусто — подсказка', async () => {
		const { t } = mockTransport({ '/graph': () => graph([]) })
		const o = opts()
		await runCommand(['space', 'ls'], t, o)
		assert.match(o.stdout.join('\n'), /пространств нет/)
	})

	it('space ls --json', async () => {
		const { t } = mockTransport({ '/graph': () => graph([space]) })
		const o = opts()
		await runCommand(['space', 'ls', '--json'], t, o)
		const list = JSON.parse(o.stdout[0] ?? '[]') as SpaceView[]
		assert.equal(list[0]?.name, 'ws')
	})

	it('space add без пути — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['space', 'add'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('space add — POST /spaces с путём и опциями', async () => {
		const { t, calls } = mockTransport({ '/spaces': () => space })
		const o = opts()
		await runCommand(['space', 'add', 'ws2', '--name', 'ws', '--url', 'http://x'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(calls[0]?.path, '/spaces')
		assert.equal(body['path'], '/ws/ws2')
		assert.equal(body['name'], 'ws')
		assert.equal(body['url'], 'http://x')
		assert.match(o.stdout.join('\n'), /добавлено/)
	})

	it('space add --json', async () => {
		const { t } = mockTransport({ '/spaces': () => space })
		const o = opts()
		await runCommand(['space', 'add', '--json', 'ws2'], t, o)
		assert.equal((JSON.parse(o.stdout[0] ?? '{}') as { name: string }).name, 'ws')
	})

	it('space rm без имени — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['space', 'rm'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('space rm — DELETE /spaces/:name', async () => {
		const { t, calls } = mockTransport({ '/spaces/ws': () => undefined })
		const o = opts()
		await runCommand(['space', 'rm', 'ws'], t, o)
		const call = calls[0] as { method: string; path: string }
		assert.equal(call.method, 'DELETE')
		assert.equal(call.path, '/spaces/ws')
		assert.match(o.stdout.join('\n'), /удалено/)
	})

	it('space неизвестная подкоманда — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['space', 'bogus'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})
})
