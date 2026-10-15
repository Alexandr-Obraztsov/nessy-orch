import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { acquireInstance, readLock } from '../../../src/infrastructure/process/single-instance'

const home = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'orch-lock-'))
const lock = (h: string, pid: number, build: string): void => fs.writeFileSync(path.join(h, 'orch.lock'), JSON.stringify({ pid, build, startedAt: 1 }))

describe('единственный оркестратор', () => {
	it('нет замка или замок мёртвого — занимаем', () => {
		const h = home()
		assert.deepEqual(acquireInstance(h, '1.0.1.1'), { ok: true })
		lock(h, 999999, '1.0.1.1')
		assert.deepEqual(acquireInstance(h, '1.0.2.1', { isAlive: () => false }), { ok: true })
		assert.equal(readLock(h)?.pid, process.pid)
	})
	it('живой держатель любой сборки — уступаем, замок не трогаем', () => {
		const h = home()
		lock(h, 4242, '1.0.1.1')
		const r = acquireInstance(h, '1.0.9.1', { isAlive: () => true })
		assert.equal(r.ok, false)
		assert.equal(readLock(h)?.pid, 4242)
	})
})
