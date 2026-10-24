/** CLI: правки улучшателя, ждущие решения (`playbook edits | accept | reject <id> <hash>`). */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PendingEdit } from '../../../shared/types'
import { parseArgs } from '../../../src/interfaces/cli/args'
import { resolveEdit } from '../../../src/interfaces/cli/commands/learning'
import { CliError } from '../../../src/interfaces/cli/errors'
import { PLAYBOOK_FLAGS } from '../../../src/interfaces/cli/flags'

const edit = (hash: string): PendingEdit => ({
	hash,
	file: 'SKILL.md',
	before: 'a',
	after: 'b',
	anchor: 'n 2',
	caseId: 'c1',
	createdAt: '2026-10-01T10:00:00Z',
})

describe('CLI: правки плейбука', () => {
	it('resolveEdit: полный хэш и однозначное начало', () => {
		const list = [edit('abcdef0123'), edit('ab99999999')]
		assert.equal(resolveEdit(list, 'abcdef0123').hash, 'abcdef0123')
		assert.equal(resolveEdit(list, 'abcd').hash, 'abcdef0123')
	})
	it('resolveEdit: неоднозначное, слишком короткое и неизвестное — CliError с кодом 2', () => {
		const list = [edit('abcdef0123'), edit('abcd999999')]
		for (const h of ['abcd', 'ab', 'ffff'])
			assert.throws(
				() => resolveEdit(list, h),
				(e: unknown) => e instanceof CliError && e.exitCode === 2,
			)
	})
	it('playbook accept <id> <hash>: позиционные аргументы', () => {
		assert.deepEqual(parseArgs(['accept', 'p-x', 'abcd'], PLAYBOOK_FLAGS).positionals, ['accept', 'p-x', 'abcd'])
	})
})
