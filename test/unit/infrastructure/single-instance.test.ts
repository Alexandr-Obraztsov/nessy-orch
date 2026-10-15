import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { acquireInstance, readLock } from '../../../src/infrastructure/process/single-instance'
import { compareBuild } from '../../../src/interfaces/cli/runtime'

const home = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'orch-lock-'))
const lock = (h: string, pid: number, build: string): void => fs.writeFileSync(path.join(h, 'orch.lock'), JSON.stringify({ pid, build, startedAt: 1 }))

describe('единственный оркестратор', () => {
	it('нет замка или замок мёртвого — занимаем без убийств', async () => {
		const h = home()
		assert.deepEqual(await acquireInstance(h, '1.0.1.1', { compare: compareBuild }), { ok: true, tookOver: null })
		lock(h, 999999, '1.0.1.1')
		const sent: string[] = []
		const r = await acquireInstance(h, '1.0.2.1', { compare: compareBuild, isAlive: () => false, signal: (p, s) => sent.push(`${p}:${s}`) })
		assert.deepEqual(r, { ok: true, tookOver: null })
		assert.deepEqual(sent, [])
		assert.equal(readLock(h)?.pid, process.pid)
	})
	it('живой прежний: TERM, затем KILL, если не ушёл; замок переходит к нам', async () => {
		const h = home()
		lock(h, 4242, '1.0.1.1')
		const sent: string[] = []
		const r = await acquireInstance(h, '1.0.2.1', {
			compare: compareBuild,
			isAlive: p => p === 4242 && !sent.includes('4242:SIGKILL'),
			signal: (p, s) => sent.push(`${p}:${s}`),
			sleep: () => Promise.resolve(),
			termWaitMs: 400,
		})
		assert.deepEqual(r, { ok: true, tookOver: 4242 })
		assert.deepEqual(sent, ['4242:SIGTERM', '4242:SIGKILL'])
	})
	it('замок новее нас — уступаем и никого не трогаем', async () => {
		const h = home()
		lock(h, 4242, '1.0.9.1')
		const sent: string[] = []
		const r = await acquireInstance(h, '1.0.2.1', { compare: compareBuild, isAlive: () => true, signal: (p, s) => sent.push(`${p}:${s}`) })
		assert.equal(r.ok, false)
		assert.deepEqual(sent, [])
	})
})
