/** CLI «Фона»: learn / case / playbook в формате команд нового CLI (CommandTable, Ctx, Transport). */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CaseReadBlock, LearningCards } from '../../../../../shared/types'
import { runCommand } from '../../../../../src/interfaces/cli/dispatch'
import { CliError } from '../../../../../src/interfaces/cli/errors'
import { mockTransport, opts } from '../../../../support/cli-helper'

describe('CLI learning', () => {
	it('learn on — PATCH /learning/settings {enabled}', async () => {
		const { t, calls } = mockTransport({ '/learning/settings': () => ({ enabled: true, disabledSessions: [] }) })
		const o = opts()
		await runCommand(['learn', 'on'], t, o)
		assert.deepEqual(calls[0], { method: 'PATCH', path: '/learning/settings', body: { enabled: true } })
		assert.match(o.stdout.join('\n'), /обучение включено/)
	})

	it('case ls --cards --json — карточки кейсов', async () => {
		const cards: LearningCards = { cases: [{ id: 'c-1', card: 'карточка' }], playbooks: [] }
		const { t, calls } = mockTransport({ '/learning/cards': () => cards })
		const o = opts()
		await runCommand(['case', 'ls', '--cards', '--json'], t, o)
		assert.equal(calls[0]?.path, '/learning/cards')
		assert.deepEqual(JSON.parse(o.stdout[0] ?? '[]'), cards.cases)
	})

	it('case read: блок — в stdout, прогресс — в stderr; done — только stderr', async () => {
		const block: Pick<CaseReadBlock, 'done' | 'header' | 'text' | 'card' | 'from' | 'until' | 'remaining' | 'total'> = {
			done: false,
			header: 'BLOCK 1',
			text: '[1] событие',
			card: 'CARD',
			from: 1,
			until: 1,
			remaining: 0,
			total: 1,
		}
		const { t, calls } = mockTransport({ '/learning/cases/c-1/read': () => block })
		const o = opts()
		await runCommand(['case', 'read', 'c-1'], t, o)
		assert.equal(calls[0]?.path, '/learning/cases/c-1/read')
		assert.equal(o.stdout.join('\n'), 'BLOCK 1\n\n[1] событие\n\nCARD')
		assert.match(o.stderr.join('\n'), /^block n 1–1 issued/)
		const done = mockTransport({ '/learning/cases/c-1/read': () => ({ done: true, card: 'FINAL' }) })
		const o2 = opts()
		await runCommand(['case', 'read', 'c-1'], done.t, o2)
		assert.deepEqual(o2.stdout, [])
		assert.equal(o2.stderr.join('\n'), 'done\nFINAL')
	})

	it('case draft --from --key: ключ агента уходит в транспорт, текст из --file', async () => {
		const { t, calls, keys } = mockTransport({ '/learning/cases/c-1/draft?final=1': () => ({ message: 'ACCEPTED: final' }) })
		const o = opts()
		await runCommand(['case', 'draft', 'c-1', '--final', '--from', 'a1', '--key', 'k1', '--file', __filename], t, o)
		assert.equal(keys[0], 'k1')
		assert.equal(calls[0]?.path, '/learning/cases/c-1/draft?final=1')
		const sent = calls[0]
		assert.ok(sent)
		assert.deepEqual(Object.keys(sent.body as object), ['text', 'from'])
		assert.deepEqual(o.stderr, ['ACCEPTED: final'])
	})

	it('playbook: неизвестная подкоманда и reject без id — CliError с кодом 2', async () => {
		const { t } = mockTransport({})
		await assert.rejects(runCommand(['playbook', 'bogus'], t, opts()), (e: unknown) => e instanceof CliError && e.exitCode === 2)
		await assert.rejects(runCommand(['playbook', 'reject'], t, opts()), (e: unknown) => e instanceof CliError && e.exitCode === 2)
	})
})
