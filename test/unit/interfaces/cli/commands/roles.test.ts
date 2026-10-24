import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../../src/interfaces/cli/dispatch'
import { CliError } from '../../../../../src/interfaces/cli/errors'
import { mockTransport, opts } from '../../../../support/cli-helper'
import type { GraphView, RoleView } from '../../../../../shared/types'

const role: RoleView = {
	id: 'dev',
	name: 'Разработчик',
	description: 'пишет код',
	instructions: 'Делай хорошо',
	color: 210,
	icon: null,
	createdAt: '',
	updatedAt: '',
}
const graph = (roles: RoleView[]): GraphView => ({ rev: 1, spaces: [], agents: [], sessions: [], roles })

describe('CLI role', () => {
	it('role ls — список ролей в stdout', async () => {
		const { t, calls } = mockTransport({ '/graph': () => graph([role]) })
		const o = opts()
		await runCommand(['role', 'ls'], t, o)
		assert.equal(calls[0]?.path, '/graph')
		assert.match(o.stdout.join('\n'), /dev/)
	})

	it('role (без подкоманды) — то же, что ls', async () => {
		const { t } = mockTransport({ '/graph': () => graph([role]) })
		const o = opts()
		await runCommand(['role'], t, o)
		assert.match(o.stdout.join('\n'), /dev/)
	})

	it('role ls пусто — подсказка', async () => {
		const { t } = mockTransport({ '/graph': () => graph([]) })
		const o = opts()
		await runCommand(['role', 'ls'], t, o)
		assert.match(o.stdout.join('\n'), /ролей нет/)
	})

	it('role ls --json', async () => {
		const { t } = mockTransport({ '/graph': () => graph([role]) })
		const o = opts()
		await runCommand(['role', 'ls', '--json'], t, o)
		const list = JSON.parse(o.stdout[0] ?? '[]') as RoleView[]
		assert.equal(list[0]?.id, 'dev')
	})

	it('role show без id — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['role', 'show'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('role show — GET /roles/:id, инструкции в stdout', async () => {
		const { t, calls } = mockTransport({ '/roles/dev': () => role })
		const o = opts()
		await runCommand(['role', 'show', 'dev'], t, o)
		assert.equal(calls[0]?.path, '/roles/dev')
		assert.match(o.stdout.join('\n'), /Делай хорошо/)
	})

	it('role show --json', async () => {
		const { t } = mockTransport({ '/roles/dev': () => role })
		const o = opts()
		await runCommand(['role', 'show', '--json', 'dev'], t, o)
		assert.equal((JSON.parse(o.stdout[0] ?? '{}') as { id: string }).id, 'dev')
	})

	it('role add без имени/инструкций — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['role', 'add', 'dev'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('role add — POST /roles с телом', async () => {
		const { t, calls } = mockTransport({ '/roles': () => role })
		const o = opts()
		await runCommand(['role', 'add', 'dev', '--instructions', 'делать', '--description', 'desc', '--color', '120', '--id', 'dev'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(calls[0]?.path, '/roles')
		assert.equal(body['name'], 'dev')
		assert.equal(body['instructions'], 'делать')
		assert.equal(body['description'], 'desc')
		assert.equal(body['color'], 120)
		assert.equal(body['id'], 'dev')
		assert.match(o.stdout.join('\n'), /добавлена/)
	})

	it('role add --json', async () => {
		const { t } = mockTransport({ '/roles': () => role })
		const o = opts()
		await runCommand(['role', 'add', '--json', 'dev', '--instructions', 'x'], t, o)
		assert.equal((JSON.parse(o.stdout[0] ?? '{}') as { id: string }).id, 'dev')
	})

	it('role rm без id — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['role', 'rm'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('role rm — DELETE /roles/:id', async () => {
		const { t, calls } = mockTransport({ '/roles/dev': () => undefined })
		const o = opts()
		await runCommand(['role', 'rm', 'dev'], t, o)
		const call = calls[0] as { method: string; path: string }
		assert.equal(call.method, 'DELETE')
		assert.equal(call.path, '/roles/dev')
		assert.match(o.stdout.join('\n'), /удалена/)
	})

	it('role неизвестная подкоманда — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['role', 'bogus'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})
})

describe('CLI role: model/runtime', () => {
	it('role add --model --runtime — в теле POST /roles; пустая --model даёт null', async () => {
		const { t, calls } = mockTransport({ '/roles': () => role })
		await runCommand(['role', 'add', 'Имя', '--instructions', 'x', '--model', 'opus', '--runtime', 'tclaude'], t, opts())
		const b = calls[0]?.body as Record<string, unknown>
		assert.equal(b['model'], 'opus')
		assert.equal(b['runtime'], 'tclaude')
		await runCommand(['role', 'add', 'Имя', '--instructions', 'x', '--model', ''], t, opts())
		assert.equal((calls[1]?.body as Record<string, unknown>)['model'], null)
	})

	it('role add --runtime с неизвестным значением — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['role', 'add', 'Имя', '--instructions', 'x', '--runtime', 'foo'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('role update — GET, затем PUT с прежними name/instructions и новой моделью', async () => {
		const { t, calls } = mockTransport({ '/roles/dev': () => role })
		const o = opts()
		await runCommand(['role', 'update', 'dev', '--model', 'sonnet', '--runtime', ''], t, o)
		assert.equal(calls[0]?.method, 'GET')
		assert.equal(calls[1]?.method, 'PUT')
		const b = calls[1]?.body as Record<string, unknown>
		assert.equal(b['name'], 'Разработчик')
		assert.equal(b['instructions'], 'Делай хорошо')
		assert.equal(b['model'], 'sonnet')
		assert.equal(b['runtime'], null)
	})

	it('role update без флагов модели — поля model/runtime в теле нет', async () => {
		const { t, calls } = mockTransport({ '/roles/dev': () => role })
		await runCommand(['role', 'update', 'dev', '--description', 'новое'], t, opts())
		const b = calls[1]?.body as Record<string, unknown>
		assert.equal('model' in b, false)
		assert.equal('runtime' in b, false)
		assert.equal(b['description'], 'новое')
	})

	it('role update без id — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['role', 'update'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('role ls и show выводят модель и рантайм', async () => {
		const r: RoleView = { ...role, model: 'opus', runtime: 'tclaude' }
		const { t } = mockTransport({ '/graph': () => graph([r]), '/roles/dev': () => r })
		const o = opts()
		await runCommand(['role', 'ls'], t, o)
		await runCommand(['role', 'show', 'dev'], t, o)
		const out = o.stdout.join('\n')
		assert.match(out, /tclaude · opus/)
		assert.match(out, /рантайм tclaude {2}модель opus/)
	})
})
