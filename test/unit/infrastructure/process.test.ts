/** Процессы: распознавание командных строк, lock второго экземпляра, классификация serve в doctor. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import { acquireLock } from '../../../src/infrastructure/process/instance-lock'
import { aliveMatching, commandLine, isOrchCommand, isServeCommand } from '../../../src/infrastructure/process/process-table'
import { classifyServes } from '../../../src/interfaces/cli/commands/doctor.commands'
import { exited, spawnDummy } from '../../support/procs'
import { until } from '../../support/wait'

describe('процессы', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-proc-'))
	const kids: { kill: (s: NodeJS.Signals) => boolean }[] = []
	after(() => {
		for (const k of kids) k.kill('SIGKILL')
		fs.rmSync(tmp, { recursive: true, force: true })
	})

	it('командные строки serve и оркестратора', () => {
		assert.ok(isServeCommand('/Users/u/.local/bin/nessy serve --port 4360 --hostname 127.0.0.1 --no-web --workspace /w'))
		assert.ok(isServeCommand('node /x/fake-nessy.js serve --port 1 --workspace /w'))
		assert.ok(!isServeCommand('nessy serve --port 4360'), 'без --workspace — не наш serve')
		assert.ok(!isServeCommand('node server.js --workspace /w'))
		assert.ok(isOrchCommand('/usr/local/bin/node /Users/u/Projects/nessy-orch/dist/src/main.js'))
		assert.ok(!isOrchCommand('node /Users/u/Projects/nessy-orch/dist/src/interfaces/cli/main.js doctor'))
		assert.match(commandLine(process.pid) ?? '', /node/)
		assert.equal(commandLine(2 ** 22 + 7), null)
	})

	it('lock: живой оркестратор не пускает второй экземпляр; мёртвый или чужой pid — перезаписывается', async () => {
		const home = path.join(tmp, 'h1')
		const file = path.join(home, 'orch.lock')
		const orch = spawnDummy(['dist/src/main.js'])
		const other = spawnDummy(['not-orch'])
		kids.push(orch, other)
		await until(() => aliveMatching(orch.pid ?? 0, isOrchCommand), 3000, 'пустышка')

		fs.mkdirSync(home, { recursive: true })
		fs.writeFileSync(file, String(orch.pid))
		assert.deepEqual(acquireLock(home), { ok: false, pid: orch.pid })
		assert.equal(fs.readFileSync(file, 'utf8'), String(orch.pid), 'файл не тронут')

		fs.writeFileSync(file, String(other.pid))
		const l1 = acquireLock(home)
		assert.ok(l1.ok, 'pid жив, но это не оркестратор')
		assert.equal(fs.readFileSync(file, 'utf8').trim(), String(process.pid))
		l1.release()
		assert.equal(fs.existsSync(file), false)

		orch.kill('SIGKILL')
		await exited(orch, 3000)
		fs.writeFileSync(file, String(orch.pid))
		const l2 = acquireLock(home)
		assert.ok(l2.ok, 'мёртвый pid')
		l2.release()
	})

	it('doctor: owned / orphan / foreign', () => {
		const procs = [
			{ pid: 10, ppid: 1, etime: '01:00', command: '/usr/bin/node /p/dist/src/main.js' },
			{ pid: 11, ppid: 10, etime: '00:50', command: 'nessy serve --port 4360 --workspace /a' },
			{ pid: 12, ppid: 1, etime: '05:00', command: 'nessy serve --port 4361 --workspace /b' },
			{ pid: 13, ppid: 500, etime: '05:00', command: 'nessy serve --port 4362 --workspace /c' },
			{ pid: 14, ppid: 500, etime: '05:00', command: 'nessy serve --port 4363 --workspace /d' },
			{ pid: 20, ppid: 1, etime: '09:00', command: '/usr/bin/node /p/dist/src/main.js' },
			{ pid: 21, ppid: 20, etime: '09:00', command: 'nessy serve --port 4364 --workspace /e' },
			{ pid: 30, ppid: 1, etime: '09:00', command: 'vim serve.txt' },
		]
		const byPid = Object.fromEntries(classifyServes(procs, 10, new Set([13])).map(s => [s.pid, s.owner]))
		assert.deepEqual(byPid, { 11: 'owned', 12: 'orphan', 13: 'orphan', 14: 'foreign', 21: 'orphan' })
		const down = Object.fromEntries(classifyServes(procs, null, new Set()).map(s => [s.pid, s.owner]))
		assert.equal(down[11], 'orphan', 'оркестратор лежит — его дети осиротевшие')
	})
})
