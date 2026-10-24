import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import type * as fsTypes from 'node:fs'
import type * as cpTypes from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { buildClaudeEnv, defaultResolveAuth, spawnClaude, type SpawnClaudeOptions } from '../../../../src/infrastructure/tclaude/spawn-claude'

// node:test `mock.method` не работает на __importStar-namespace (геттер-свойства built-in),
// поэтому берём сырые CJS-модули: патчим те же объекты, что читает и код адаптера.
const req = createRequire(__filename)
const fs = req('node:fs') as typeof fsTypes
const cp = req('node:child_process') as typeof cpTypes

/** Аргументы execSync, важные для defaultResolveAuth (таймаут, отбрасывание stderr). */
interface ExecSyncArgs {
	timeout: number
	stdio: unknown[]
}

/** Аргументы spawn, важные для spawnClaude (HOME, stdio, cwd). */
interface SpawnOptions {
	env: NodeJS.ProcessEnv
	stdio: unknown[]
	cwd: string
}

/** Вернуть значение переменной окружения на время теста, восстановить после. */
function withHome(value: string | undefined, fn: () => void): void {
	const prev = process.env['HOME']
	if (value === undefined) delete process.env['HOME']
	else process.env['HOME'] = value
	try {
		fn()
	} finally {
		if (prev === undefined) delete process.env['HOME']
		else process.env['HOME'] = prev
	}
}

describe('defaultResolveAuth', () => {
	it('HOME не задан → {}', () => {
		withHome(undefined, () => assert.deepEqual(defaultResolveAuth(), {}))
	})

	it('apiKeyHelper: токен из execSync (обрезан) + baseUrl из settings.env', () => {
		const read = mock.method(fs, 'readFileSync', () => JSON.stringify({ apiKeyHelper: 'helper-cmd', env: { ANTHROPIC_BASE_URL: 'https://proxy' } }))
		const exec = mock.method(cp, 'execSync', () => '  TOKEN123\n')
		withHome('/home/u', () => {
			try {
				const auth = defaultResolveAuth()
				assert.deepEqual(auth, { baseUrl: 'https://proxy', token: 'TOKEN123' })
				assert.equal(exec.mock.callCount(), 1)
				const call = exec.mock.calls[0]
				assert.ok(call, 'ожидали вызов execSync')
				const args = call.arguments as unknown[]
				const cmd = args[0] as string
				const opts = args[1] as ExecSyncArgs
				assert.equal(cmd, 'helper-cmd')
				assert.equal(opts.timeout, 15_000)
			} finally {
				read.mock.restore()
				exec.mock.restore()
			}
		})
	})

	it('env.ANTHROPIC_AUTH_TOKEN в settings (без apiKeyHelper): токен оттуда, execSync не вызывается', () => {
		const read = mock.method(fs, 'readFileSync', () => JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'SETTINGS_TK' } }))
		const exec = mock.method(cp, 'execSync', () => {
			throw new Error('не должен вызываться')
		})
		withHome('/home/u', () => {
			try {
				assert.deepEqual(defaultResolveAuth(), { token: 'SETTINGS_TK' })
				assert.equal(exec.mock.callCount(), 0)
			} finally {
				read.mock.restore()
				exec.mock.restore()
			}
		})
	})

	it('baseUrl фолбэк на process.env, когда в settings нет ANTHROPIC_BASE_URL', () => {
		const read = mock.method(fs, 'readFileSync', () => JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'TK' } }))
		const prev = process.env['ANTHROPIC_BASE_URL']
		process.env['ANTHROPIC_BASE_URL'] = 'https://env-proxy'
		withHome('/home/u', () => {
			try {
				assert.deepEqual(defaultResolveAuth(), { baseUrl: 'https://env-proxy', token: 'TK' })
			} finally {
				read.mock.restore()
				if (prev === undefined) delete process.env['ANTHROPIC_BASE_URL']
				else process.env['ANTHROPIC_BASE_URL'] = prev
			}
		})
	})

	it('settings.json отсутствует (readFileSync бросает) → {}', () => {
		const read = mock.method(fs, 'readFileSync', () => {
			throw new Error('ENOENT')
		})
		withHome('/home/u', () => {
			try {
				assert.deepEqual(defaultResolveAuth(), {})
			} finally {
				read.mock.restore()
			}
		})
	})

	it('apiKeyHelper упал (execSync бросает) → {}', () => {
		const read = mock.method(fs, 'readFileSync', () => JSON.stringify({ apiKeyHelper: 'fail-cmd' }))
		const exec = mock.method(cp, 'execSync', () => {
			throw new Error('exit 1')
		})
		withHome('/home/u', () => {
			try {
				assert.deepEqual(defaultResolveAuth(), {})
			} finally {
				read.mock.restore()
				exec.mock.restore()
			}
		})
	})
})

describe('buildClaudeEnv', () => {
	it('resolveAuth применяется только при отсутствии токена в env', () => {
		const env = buildClaudeEnv({
			bin: 't',
			permissionMode: 'default',
			homeDir: '/h',
			cwd: '/ws',
			env: { ANTHROPIC_AUTH_TOKEN: 'EXISTING', ANTHROPIC_BASE_URL: 'https://explicit' },
			resolveAuth: () => ({ token: 'TK', baseUrl: 'https://proxy' }),
		})
		assert.equal(env['ANTHROPIC_AUTH_TOKEN'], 'EXISTING')
		assert.equal(env['ANTHROPIC_BASE_URL'], 'https://explicit')
		assert.equal(env['HOME'], '/h')
	})

	it('NESSY_ORCH_TOKEN вырезается из env ребёнка (даже если был в process.env)', () => {
		const prev = process.env['NESSY_ORCH_TOKEN']
		process.env['NESSY_ORCH_TOKEN'] = 'OPERATOR-SECRET'
		try {
			const env = buildClaudeEnv({ bin: 't', permissionMode: 'default', homeDir: '/h', cwd: '/ws', resolveAuth: () => ({}) })
			assert.equal(env['NESSY_ORCH_TOKEN'], undefined, 'агентский процесс не должен получить токен оператора')
		} finally {
			if (prev === undefined) delete process.env['NESSY_ORCH_TOKEN']
			else process.env['NESSY_ORCH_TOKEN'] = prev
		}
	})
})

describe('spawnClaude', () => {
	it('спавн с аргументами, изолированным HOME и открытым stdin', () => {
		const fakeChild = new EventEmitter() as unknown as ChildProcess
		const s = mock.method(cp, 'spawn', () => fakeChild)
		const opts: SpawnClaudeOptions = {
			bin: '/bin/tclaude',
			permissionMode: 'default',
			homeDir: '/home/agent',
			cwd: '/ws',
			sessionId: 's1',
			resolveAuth: () => ({}),
		}
		try {
			const child = spawnClaude(opts)
			assert.equal(child, fakeChild)
			assert.equal(s.mock.callCount(), 1)
			const call = s.mock.calls[0]
			assert.ok(call, 'ожидали вызов spawn')
			const args = call.arguments as unknown[]
			const bin = args[0] as string
			const spawnOpts = args[2] as SpawnOptions
			assert.equal(bin, '/bin/tclaude')
			const argv = JSON.stringify(args[1])
			assert.ok(argv.includes('--session-id') && argv.includes('s1'))
			assert.equal(spawnOpts.env['HOME'], '/home/agent')
			assert.equal(spawnOpts.cwd, '/ws')
			assert.deepEqual(spawnOpts.stdio, ['pipe', 'pipe', 'pipe'])
		} finally {
			s.mock.restore()
		}
	})
})
