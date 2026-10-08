import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SseParser, formatFrame } from '../src/core/sse'
import { normalize, pickPermissionOption } from '../src/core/nessy-client'
import { parseArgs } from '../src/cli/args'

describe('SSE', () => {
	it('разбирает кадры, разбитые на произвольные куски', () => {
		const got: Array<{ id: string | null; event: string; data: string }> = []
		const p = new SseParser(f => got.push(f))
		const raw = formatFrame({ a: 1 }, { id: 7, event: 'x' }) + ': hb\n\n' + formatFrame({ b: 2 })
		for (const ch of raw) p.push(ch) // по одному символу
		assert.equal(got.length, 2)
		assert.deepEqual(got[0], { id: '7', event: 'x', data: '{"a":1}' })
		assert.equal(got[1]?.data, '{"b":2}')
	})
})

describe('normalize (контракт nessy)', () => {
	const wrap = (type: string, data: unknown): unknown => ({ id: 1, v: 1, type, data })
	it('текст, мысли, инструменты', () => {
		assert.deepEqual(normalize('session_update', wrap('session_update', { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } } })), { kind: 'text', text: 'hi' })
		assert.deepEqual(normalize('session_update', wrap('session_update', { update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'hm' } } })), { kind: 'thought', text: 'hm' })
		const tool = normalize('session_update', wrap('session_update', { update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Shell: ls', rawInput: { command: 'ls' }, _meta: { toolName: 'run_shell_command' } } }))
		assert.equal(tool?.kind, 'tool')
	})
	it('turn_complete, permission, мусор', () => {
		assert.deepEqual(normalize('turn_complete', wrap('turn_complete', { stopReason: 'end_turn', promptId: 'p1' })), { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p1' })
		const perm = normalize('permission_request', wrap('permission_request', { requestId: 'r', options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Да' }], toolCall: { title: 'X' } }))
		assert.equal(perm?.kind, 'permission')
		assert.equal(normalize('x', null), null)
		assert.equal(normalize('x', 'строка'), null)
		assert.equal(normalize('heartbeat', wrap('heartbeat', {})), null)
	})
	it('выбор варианта разрешения', () => {
		const opts = [
			{ optionId: 'reject_once', kind: 'reject_once', name: 'Нет' },
			{ optionId: 'allow_always', kind: 'allow_always', name: 'Всегда' },
			{ optionId: 'allow_once', kind: 'allow_once', name: 'Да' },
		]
		assert.equal(pickPermissionOption(opts, true), 'allow_once')
		assert.equal(pickPermissionOption(opts, false), 'reject_once')
		assert.equal(pickPermissionOption([], true), null)
	})
})

describe('CLI parseArgs', () => {
	const spec = { bool: ['wait', 'json'], value: ['space', 'timeout'], short: { w: 'wait' } }
	it('флаги и позиционные вперемешку', () => {
		const p = parseArgs(['--space', '/x', 'текст', '-w', '--timeout=5', 'ещё'], spec)
		assert.deepEqual(p.positionals, ['текст', 'ещё'])
		assert.equal(p.flags.get('wait'), true)
		assert.equal(p.flags.get('space'), '/x')
		assert.equal(p.flags.get('timeout'), '5')
	})
	it('`--` отделяет текст, начинающийся с дефиса', () => {
		const p = parseArgs(['--wait', '--', '--не-флаг'], spec)
		assert.deepEqual(p.positionals, ['--не-флаг'])
	})
	it('неизвестный флаг — ошибка', () => {
		assert.throws(() => parseArgs(['--nope'], spec), /неизвестный флаг/)
	})
})
