/**
 * Conformance-сьют AgentPort против serve-адаптера (integration): NessyServeAdapter поверх реального
 * транспорта fake-nessy serve (без модели). Живой nessy не нужен — транспортом служит фейковый serve,
 * но честно: это настоящие HTTP/SSE, а не мок адаптера.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import { NessyServeAdapter } from '../../src/infrastructure/nessy/agent-port-serve'
import { NessyClient } from '../../src/infrastructure/nessy/nessy-client'
import { freePort } from '../../src/infrastructure/process/free-port'
import { runAgentPortConformance } from '../support/agent-port-conformance'
import { sleep } from '../../src/lib/async'

const ROOT = path.resolve(__dirname, '..', '..', '..')
const FAKE = path.join(ROOT, 'dist', 'test', 'support', 'fake-nessy.js')

let proc: ChildProcess | null = null
let baseUrl = ''
let cwd = ''

before(async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-serve-conf-'))
	cwd = dir
	fs.mkdirSync(cwd, { recursive: true })
	const port = await freePort(26000)
	baseUrl = `http://127.0.0.1:${port}`
	proc = spawn(process.execPath, [FAKE, 'serve', '--port', String(port), '--workspace', cwd], { stdio: 'ignore' })
	// ждём /health
	const client = new NessyClient(baseUrl)
	for (let i = 0; i < 100; i++) {
		if (await client.health()) return
		await sleep(50)
	}
	throw new Error('fake-nessy serve не поднялся')
})

after(() => {
	proc?.kill('SIGTERM')
})

runAgentPortConformance({
	label: 'serve-adapter',
	cwd,
	slowPrompt: '#slow',
	makePort: () => Promise.resolve(new NessyServeAdapter({ client: new NessyClient(baseUrl), cwd })),
})

test('serve-adapter: capabilities — setModel=false, остальные true', () => {
	const port = new NessyServeAdapter({ client: new NessyClient(baseUrl), cwd })
	assert.deepEqual(port.capabilities, { streamText: true, midTurn: true, permissionVote: true, setModel: false })
	assert.ok(proc)
})