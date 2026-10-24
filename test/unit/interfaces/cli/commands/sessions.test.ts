import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { runCommand } from '../../../../../src/interfaces/cli/dispatch'
import { CliError } from '../../../../../src/interfaces/cli/errors'
import { agent, mockTransport, opts } from '../../../../support/cli-helper'
import type { GraphView, SessionView, SourceView } from '../../../../../shared/types'

const session: SessionView = {
	id: 's1',
	title: 'Сессия',
	owner: null,
	status: 'active',
	summary: null,
	createdAt: 't0',
	updatedAt: 't1',
	sources: 0,
}
const graph = (sessions: SessionView[]): GraphView => ({ rev: 1, spaces: [], roles: [], agents: [agent({ id: 'a-1', session: 's1' })], sessions })
const source: SourceView = { id: 'x1', kind: 'url', label: 'https://x', href: 'https://x', agentId: 'a-1', agentName: 'a-1', origin: 'reply', ts: 1 }

describe('CLI session', () => {
	it('session new — POST /sessions, id и ссылка в stdout', async () => {
		const { t, calls } = mockTransport({ '/sessions': () => session })
		const o = opts()
		await runCommand(['session', 'new', 'Заголовок', '--owner', 'lead'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(calls[0]?.path, '/sessions')
		assert.equal(body['title'], 'Заголовок')
		assert.equal(body['owner'], 'lead')
		assert.match(o.stdout.join('\n'), /s1/)
		assert.match(o.stdout.join('\n'), /nessy-orch:\/\/session/)
	})

	it('session new без заголовка — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['session', 'new'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('session new --json', async () => {
		const { t } = mockTransport({ '/sessions': () => session })
		const o = opts()
		await runCommand(['session', 'new', '--json', 'Заголовок'], t, o)
		assert.equal((JSON.parse(o.stdout[0] ?? '{}') as { id: string }).id, 's1')
	})

	it('session ls — активные сессии', async () => {
		const { t } = mockTransport({ '/graph': () => graph([session]) })
		const o = opts()
		await runCommand(['session', 'ls'], t, o)
		assert.match(o.stdout.join('\n'), /s1/)
	})

	it('session ls --all — с завершёнными', async () => {
		const { t } = mockTransport({ '/graph': () => graph([session, { ...session, id: 's2', status: 'done' }]) })
		const o = opts()
		await runCommand(['session', 'ls', '--all'], t, o)
		assert.match(o.stdout.join('\n'), /s2/)
	})

	it('session ls --json', async () => {
		const { t } = mockTransport({ '/graph': () => graph([session]) })
		const o = opts()
		await runCommand(['session', 'ls', '--json'], t, o)
		const list = JSON.parse(o.stdout[0] ?? '[]') as SessionView[]
		assert.equal(list[0]?.id, 's1')
	})

	it('session show без id — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['session', 'show'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('session show — сессия и агенты', async () => {
		const { t } = mockTransport({
			'/sessions/s1': () => session,
			'/agents?session=s1': () => [agent({ id: 'a-1', session: 's1' })],
		})
		const o = opts()
		await runCommand(['session', 'show', 's1'], t, o)
		assert.match(o.stdout.join('\n'), /s1/)
		assert.match(o.stdout.join('\n'), /a-1/)
	})

	it('session show --json', async () => {
		const { t } = mockTransport({ '/sessions/s1': () => session, '/agents?session=s1': () => [] })
		const o = opts()
		await runCommand(['session', 'show', '--json', 's1'], t, o)
		assert.ok((JSON.parse(o.stdout[0] ?? '{}') as { session: unknown }).session)
	})

	it('session show с итогом — выводится summary', async () => {
		const { t } = mockTransport({ '/sessions/s1': () => ({ ...session, summary: 'Итог работы' }), '/agents?session=s1': () => [] })
		const o = opts()
		await runCommand(['session', 'show', 's1'], t, o)
		assert.match(o.stdout.join('\n'), /Итог работы/)
	})

	it('session sources — список', async () => {
		const { t } = mockTransport({ '/sessions/s1/sources': () => [source] })
		const o = opts()
		await runCommand(['session', 'sources', 's1'], t, o)
		assert.match(o.stdout.join('\n'), /https:\/\/x/)
	})

	it('session sources пусто — подсказка', async () => {
		const { t } = mockTransport({ '/sessions/s1/sources': () => [] })
		const o = opts()
		await runCommand(['session', 'sources', 's1'], t, o)
		assert.match(o.stdout.join('\n'), /источников пока нет/)
	})

	it('session sources --json', async () => {
		const { t } = mockTransport({ '/sessions/s1/sources': () => [source] })
		const o = opts()
		await runCommand(['session', 'sources', '--json', 's1'], t, o)
		assert.equal((JSON.parse(o.stdout[0] ?? '[]') as Array<{ id: string }>)[0]?.id, 'x1')
	})

	it('session done — PATCH со статусом и итогом', async () => {
		const { t, calls } = mockTransport({ '/sessions/s1': () => ({ ...session, status: 'done', summary: 'итог' }) })
		const o = opts()
		await runCommand(['session', 'done', 's1', '--summary', 'итог'], t, o)
		const body = calls[0]?.body as Record<string, unknown>
		assert.equal(calls[0]?.method, 'PATCH')
		assert.equal(body['status'], 'done')
		assert.equal(body['summary'], 'итог')
		assert.match(o.stdout.join('\n'), /завершена/)
	})

	it('session reopen — PATCH со статусом active', async () => {
		const { t, calls } = mockTransport({ '/sessions/s1': () => session })
		const o = opts()
		await runCommand(['session', 'reopen', 's1'], t, o)
		assert.equal((calls[0]?.body as Record<string, unknown>)['status'], 'active')
		assert.match(o.stdout.join('\n'), /снова активна/)
	})

	it('session done --summary и --summary-file вместе — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['session', 'done', 's1', '--summary', 'a', '--summary-file', 'f'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('session done --summary-file — итог из файла', async () => {
		const f = path.join(os.tmpdir(), `cli-summary-${Date.now()}.md`)
		fs.writeFileSync(f, 'итог из файла')
		try {
			const { t, calls } = mockTransport({ '/sessions/s1': () => ({ ...session, status: 'done' }) })
			await runCommand(['session', 'done', 's1', '--summary-file', f], t, opts())
			assert.equal((calls[0]?.body as Record<string, unknown>)['summary'], 'итог из файла')
		} finally {
			fs.rmSync(f, { force: true })
		}
	})

	it('session done --summary-file c нечитаемым файлом — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['session', 'done', 's1', '--summary-file', '/nonexistent/x.md'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})

	it('session rm — DELETE /sessions/:id', async () => {
		const { t, calls } = mockTransport({ '/sessions/s1': () => undefined })
		const o = opts()
		await runCommand(['session', 'rm', 's1'], t, o)
		assert.equal(calls[0]?.method, 'DELETE')
		assert.match(o.stdout.join('\n'), /удалена/)
	})

	it('session неизвестная подкоманда — CliError 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(
			() => runCommand(['session', 'bogus'], t, opts()),
			(e: unknown) => e instanceof CliError && e.exitCode === 2,
		)
	})
})
