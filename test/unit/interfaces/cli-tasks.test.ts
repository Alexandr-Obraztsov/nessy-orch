/** CLI задач: разбор флагов task/spawn/inbox/ls, NESSY_ORCH_TASK по умолчанию, ссылка на панель, итог из файла. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { flagBool, flagStr, parseArgs } from '../../../src/interfaces/cli/args'
import { INBOX_FLAGS, LS_FLAGS, SPAWN_FLAGS } from '../../../src/interfaces/cli/commands/flags'
import { readSummary, TASK_FLAGS, taskOption, taskUrl } from '../../../src/interfaces/cli/commands/tasks.commands'
import { CliError } from '../../../src/interfaces/cli/errors'

describe('CLI: задачи', () => {
	it('task new "<заголовок>" --owner --id', () => {
		const p = parseArgs(['new', 'Починить', 'CI', '--owner', 'claude', '--id=fix-ci', '--json'], TASK_FLAGS)
		assert.deepEqual(p.positionals, ['new', 'Починить', 'CI'])
		assert.equal(flagStr(p, 'owner'), 'claude')
		assert.equal(flagStr(p, 'id'), 'fix-ci')
		assert.equal(flagBool(p, 'json'), true)
	})
	it('task ls -a, task done --summary', () => {
		assert.equal(flagBool(parseArgs(['ls', '-a'], TASK_FLAGS), 'all'), true)
		const p = parseArgs(['done', 'fix-ci', '--summary', 'итог'], TASK_FLAGS)
		assert.equal(readSummary(p), 'итог')
		assert.equal(readSummary(parseArgs(['done', 'x'], TASK_FLAGS)), undefined)
	})
	it('--summary-file читает файл; оба флага сразу — ошибка с кодом 2', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-tasks-'))
		const f = path.join(dir, 's.md')
		fs.writeFileSync(f, '**Итог** из файла\n')
		try {
			assert.equal(readSummary(parseArgs(['done', 'x', '--summary-file', f], TASK_FLAGS)), '**Итог** из файла\n')
			assert.throws(
				() => readSummary(parseArgs(['done', 'x', '--summary', 'a', '--summary-file', f], TASK_FLAGS)),
				(e: unknown) => e instanceof CliError && e.exitCode === 2,
			)
			assert.throws(() => readSummary(parseArgs(['done', 'x', '--summary-file', path.join(dir, 'нет.md')], TASK_FLAGS)), /не удалось прочитать/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
	it('--task у spawn, inbox, ls; NESSY_ORCH_TASK — значение по умолчанию, флаг важнее', () => {
		const spawn = parseArgs(['--task', 'fix-ci', '--role', 'code-explorer', 'задача'], SPAWN_FLAGS)
		assert.equal(taskOption(spawn, {}), 'fix-ci')
		assert.equal(taskOption(spawn, { NESSY_ORCH_TASK: 'other' }), 'fix-ci')
		const inbox = parseArgs(['--wait', '1500'], INBOX_FLAGS)
		assert.equal(taskOption(inbox, { NESSY_ORCH_TASK: 'env-task' }), 'env-task')
		assert.equal(taskOption(inbox, { NESSY_ORCH_TASK: '  ' }), undefined)
		assert.equal(taskOption(inbox, {}), undefined)
		assert.equal(taskOption(parseArgs(['--all', '--task=t1'], LS_FLAGS), {}), 't1')
		assert.throws(() => parseArgs(['--task'], INBOX_FLAGS), /требует значение/)
	})
	it('ссылка на задачу — с хостом и портом клиента', () => {
		assert.equal(taskUrl({ host: '127.0.0.1', port: 4337 }, 'fix-ci-3f2a'), 'http://127.0.0.1:4337/?task=fix-ci-3f2a')
		assert.equal(taskUrl({ host: '127.0.0.1', port: 5000 }, 'a b'), 'http://127.0.0.1:5000/?task=a%20b')
	})
})
