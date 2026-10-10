/** CLI сессий: разбор флагов session/spawn/inbox/ls, NESSY_ORCH_SESSION по умолчанию, ссылка на панель, итог из файла. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { flagBool, flagStr, parseArgs } from '../../../src/interfaces/cli/args'
import { INBOX_FLAGS, LS_FLAGS, SPAWN_FLAGS } from '../../../src/interfaces/cli/commands/flags'
import { readSummary, SESSION_FLAGS, sessionOption, sessionUrl } from '../../../src/interfaces/cli/commands/sessions.commands'
import { CliError } from '../../../src/interfaces/cli/errors'

describe('CLI: сессии', () => {
	it('session new "<заголовок>" --owner --id', () => {
		const p = parseArgs(['new', 'Починить', 'CI', '--owner', 'claude', '--id=fix-ci', '--json'], SESSION_FLAGS)
		assert.deepEqual(p.positionals, ['new', 'Починить', 'CI'])
		assert.equal(flagStr(p, 'owner'), 'claude')
		assert.equal(flagStr(p, 'id'), 'fix-ci')
		assert.equal(flagBool(p, 'json'), true)
	})
	it('session ls -a, session done --summary', () => {
		assert.equal(flagBool(parseArgs(['ls', '-a'], SESSION_FLAGS), 'all'), true)
		const p = parseArgs(['done', 'fix-ci', '--summary', 'итог'], SESSION_FLAGS)
		assert.equal(readSummary(p), 'итог')
		assert.equal(readSummary(parseArgs(['done', 'x'], SESSION_FLAGS)), undefined)
	})
	it('--summary-file читает файл; оба флага сразу — ошибка с кодом 2', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-sessions-'))
		const f = path.join(dir, 's.md')
		fs.writeFileSync(f, '**Итог** из файла\n')
		try {
			assert.equal(readSummary(parseArgs(['done', 'x', '--summary-file', f], SESSION_FLAGS)), '**Итог** из файла\n')
			assert.throws(
				() => readSummary(parseArgs(['done', 'x', '--summary', 'a', '--summary-file', f], SESSION_FLAGS)),
				(e: unknown) => e instanceof CliError && e.exitCode === 2,
			)
			assert.throws(() => readSummary(parseArgs(['done', 'x', '--summary-file', path.join(dir, 'нет.md')], SESSION_FLAGS)), /не удалось прочитать/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
	it('--session у spawn, inbox, ls; NESSY_ORCH_SESSION — значение по умолчанию, флаг важнее', () => {
		const spawn = parseArgs(['--session', 'fix-ci', '--role', 'code-explorer', 'сессия'], SPAWN_FLAGS)
		assert.equal(sessionOption(spawn, {}), 'fix-ci')
		assert.equal(sessionOption(spawn, { NESSY_ORCH_SESSION: 'other' }), 'fix-ci')
		const inbox = parseArgs(['--wait', '1500'], INBOX_FLAGS)
		assert.equal(sessionOption(inbox, { NESSY_ORCH_SESSION: 'env-session' }), 'env-session')
		assert.equal(sessionOption(inbox, { NESSY_ORCH_SESSION: '  ' }), undefined)
		assert.equal(sessionOption(inbox, {}), undefined)
		assert.equal(sessionOption(parseArgs(['--all', '--session=t1'], LS_FLAGS), {}), 't1')
		assert.throws(() => parseArgs(['--session'], INBOX_FLAGS), /требует значение/)
	})
	it('ссылка на сессию — схема приложения nessy-orch://', () => {
		assert.equal(sessionUrl({ host: '127.0.0.1', port: 4337 }, 'fix-ci-3f2a'), 'nessy-orch://session/fix-ci-3f2a')
		assert.equal(sessionUrl({ host: '127.0.0.1', port: 5000 }, 'a b'), 'nessy-orch://session/a%20b')
	})
})
