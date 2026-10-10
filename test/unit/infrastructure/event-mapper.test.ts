import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapNessyEvent, mapToolStatus, NessyEventMapper } from '../../../src/infrastructure/nessy/event-mapper'
import type { ToolCallBuffer } from '../../../src/infrastructure/nessy/protocol.types'

/** Кадр как у nessy serve: {id, v, type, data}. */
const frame = (type: string, data: unknown): unknown => ({ id: 1, v: 1, type, data })
const su = (update: Record<string, unknown>): unknown => frame('session_update', { sessionId: 's', update })
const map = (type: string, f: unknown, tools = new Map<string, ToolCallBuffer>()): ReturnType<typeof mapNessyEvent> => mapNessyEvent(type, f, tools)

describe('маппер событий nessy: session_update', () => {
	it('agent_message_chunk → text с messageId', () => {
		assert.deepEqual(map('session_update', su({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'hi' } })), {
			kind: 'text',
			text: 'hi',
			messageId: 'm1',
		})
	})
	it('agent_thought_chunk → thought; без messageId → null', () => {
		assert.deepEqual(map('session_update', su({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hm' } })), {
			kind: 'thought',
			text: 'hm',
			messageId: null,
		})
	})
	it('пустой текст не порождает событие', () => {
		assert.equal(map('session_update', su({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } })), null)
	})
	it("_meta['nessy/error'] → turn_error, а не текст", () => {
		const ev = map(
			'session_update',
			su({
				sessionUpdate: 'agent_message_chunk',
				messageId: 'm1',
				content: { type: 'text', text: 'Rate limit', _meta: { 'nessy/error': { message: 'Rate limit exceeded', retryable: true, code: 429, requestId: 'r' } } },
			}),
		)
		assert.deepEqual(ev, { kind: 'turn_error', message: 'Rate limit exceeded', retryable: true, code: 429 })
		const bare = map('session_update', su({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'упало', _meta: { 'nessy/error': {} } } }))
		assert.deepEqual(bare, { kind: 'turn_error', message: 'упало', retryable: false, code: null })
	})
	it('user_message_chunk, current_mode_update, session_info_update, available_commands_update — игнор', () => {
		for (const s of ['user_message_chunk', 'current_mode_update', 'session_info_update', 'available_commands_update'])
			assert.equal(map('session_update', su({ sessionUpdate: s, content: { type: 'text', text: 'x' } })), null, s)
	})
})

describe('маппер событий nessy: инструменты', () => {
	it('tool_call → tool с title/input/name и статусом', () => {
		const ev = map(
			'session_update',
			su({
				sessionUpdate: 'tool_call',
				toolCallId: 't1',
				title: 'Shell: ls',
				kind: 'execute',
				status: 'pending',
				rawInput: { command: 'ls' },
				content: [],
				_meta: { toolName: 'run_shell_command' },
			}),
		)
		assert.deepEqual(ev, { kind: 'tool', toolId: 't1', name: 'run_shell_command', title: 'Shell: ls', input: { command: 'ls' }, status: 'pending', output: '' })
	})
	it('tool_call_update сливается с буфером: title/input не теряются, вывод из content', () => {
		const m = new NessyEventMapper()
		m.map('session_update', su({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read: a.md', kind: 'read', rawInput: { path: 'a.md' } }))
		const mid = m.map('session_update', su({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' }))
		assert.equal(mid?.kind, 'tool')
		assert.equal(mid.title, 'Read: a.md')
		assert.equal(mid.name, 'read')
		assert.equal(mid.status, 'in_progress')
		const done = m.map(
			'session_update',
			su({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: '', content: [{ type: 'content', content: { type: 'text', text: '# A' } }] }),
		)
		assert.deepEqual(done, { kind: 'tool', toolId: 't1', name: 'read', title: 'Read: a.md', input: { path: 'a.md' }, status: 'completed', output: '# A' })
	})
	it('update без предшествующего tool_call: заголовок — имя инструмента', () => {
		const ev = map('session_update', su({ sessionUpdate: 'tool_call_update', toolCallId: 'tx', status: 'failed', rawOutput: 'boom' }))
		assert.deepEqual(ev, { kind: 'tool', toolId: 'tx', name: 'tool', title: 'tool', input: {}, status: 'failed', output: 'boom' })
	})
	it('буфер очищается на терминальном статусе и на turn_complete', () => {
		const tools = new Map<string, ToolCallBuffer>()
		map('session_update', su({ sessionUpdate: 'tool_call', toolCallId: 'a', title: 'A' }), tools)
		map('session_update', su({ sessionUpdate: 'tool_call', toolCallId: 'b', title: 'B' }), tools)
		map('session_update', su({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' }), tools)
		assert.deepEqual([...tools.keys()], ['b'])
		map('turn_complete', frame('turn_complete', { stopReason: 'end_turn' }), tools)
		assert.equal(tools.size, 0)
	})
	it('статусы: четыре наших + синонимы отмены/ошибки', () => {
		assert.equal(mapToolStatus('pending'), 'pending')
		assert.equal(mapToolStatus('in_progress'), 'in_progress')
		assert.equal(mapToolStatus('completed'), 'completed')
		assert.equal(mapToolStatus('failed'), 'failed')
		assert.equal(mapToolStatus('cancelled'), 'failed')
		assert.equal(mapToolStatus('canceled'), 'failed')
		assert.equal(mapToolStatus('weird'), null)
		assert.equal(mapToolStatus(undefined), null)
	})
	it('tool_call без toolCallId игнорируется; rawInput-не-объект оборачивается', () => {
		assert.equal(map('session_update', su({ sessionUpdate: 'tool_call', title: 'X' })), null)
		const ev = map('session_update', su({ sessionUpdate: 'tool_call', toolCallId: 'q', rawInput: 'ls -la' }))
		assert.deepEqual(ev?.kind === 'tool' ? ev.input : null, { value: 'ls -la' })
	})
})

describe('маппер событий nessy: верхний уровень', () => {
	it('turn_complete', () => {
		assert.deepEqual(map('turn_complete', frame('turn_complete', { stopReason: 'end_turn', promptId: 'p1' })), {
			kind: 'turn_complete',
			stopReason: 'end_turn',
			promptId: 'p1',
		})
		assert.deepEqual(map('turn_complete', frame('turn_complete', {})), { kind: 'turn_complete', stopReason: 'end_turn', promptId: null })
	})
	it('prompt_cancelled → cancelled', () => {
		assert.deepEqual(map('prompt_cancelled', frame('prompt_cancelled', { promptId: 'p1' })), { kind: 'cancelled', promptId: 'p1' })
	})
	it('session_metadata_updated → meta (пустое имя — игнор)', () => {
		assert.deepEqual(map('x', frame('session_metadata_updated', { displayName: 'Обзор' })), { kind: 'meta', displayName: 'Обзор' })
		assert.equal(map('x', frame('session_metadata_updated', {})), null)
	})
	it('permission_request → permission с вариантами', () => {
		const ev = map(
			'permission_request',
			frame('permission_request', {
				requestId: 'r1',
				options: [{ optionId: 'proceed_once', kind: 'allow_once', name: 'Да' }, { junk: true }],
				toolCall: { _meta: { toolName: 'run_shell_command' } },
			}),
		)
		assert.deepEqual(ev, {
			kind: 'permission',
			requestId: 'r1',
			title: 'run_shell_command',
			options: [
				{ optionId: 'proceed_once', kind: 'allow_once', name: 'Да' },
				{ optionId: '', kind: '', name: '' },
			],
		})
	})
	it('followup_suggestion → followup', () => {
		assert.deepEqual(map('x', frame('followup_suggestion', { suggestion: 'А тесты?' })), { kind: 'followup', text: 'А тесты?' })
		assert.deepEqual(map('x', frame('followup_suggestion', { suggestions: ['a', 'b'] })), { kind: 'followup', text: 'a\nb' })
		assert.equal(map('x', frame('followup_suggestion', {})), null)
	})
	it('session_died → died, client_evicted → evicted', () => {
		assert.equal(map('x', frame('session_died', {}))?.kind, 'died')
		assert.deepEqual(map('x', frame('client_evicted', {})), { kind: 'evicted' })
	})
	it('тип берётся из имени события SSE, если в кадре его нет', () => {
		assert.deepEqual(map('prompt_cancelled', { data: { promptId: 'p' } }), { kind: 'cancelled', promptId: 'p' })
	})
	it('мусор и ненужные события → null', () => {
		assert.equal(map('x', null), null)
		assert.equal(map('x', 'строка'), null)
		assert.equal(map('x', [1, 2]), null)
		for (const t of ['replay_complete', 'session_closed', 'available_commands_update', 'workspace_changed', 'mcp_status', 'heartbeat'])
			assert.equal(map(t, frame(t, {})), null, t)
	})
})

describe('маппер событий nessy: план (ACP plan)', () => {
	it('entries {content, priority, status} → plan; priority отбрасывается, неизвестный статус → pending', () => {
		const ev = map(
			'session_update',
			su({
				sessionUpdate: 'plan',
				entries: [
					{ content: 'Прочитать', priority: 'high', status: 'completed' },
					{ content: 'Исправить', priority: 'medium', status: 'in_progress' },
					{ content: 'Проверить', priority: 'low', status: 'pending' },
					{ content: 'Странное', status: 'weird' },
					'мусор',
				],
			}),
		)
		assert.deepEqual(ev, {
			kind: 'plan',
			entries: [
				{ content: 'Прочитать', status: 'completed' },
				{ content: 'Исправить', status: 'in_progress' },
				{ content: 'Проверить', status: 'pending' },
				{ content: 'Странное', status: 'pending' },
				{ content: '', status: 'pending' },
			],
		})
	})
	it('план без entries → пустой план', () => {
		assert.deepEqual(map('session_update', su({ sessionUpdate: 'plan' })), { kind: 'plan', entries: [] })
	})
})

describe('маппер событий nessy: отдельный кадр turn_error', () => {
	it('turn_error{message,code,retryable} → turn_error', () => {
		assert.deepEqual(map('turn_error', frame('turn_error', { message: 'Rate limit', code: 429, retryable: true, promptId: 'p' })), {
			kind: 'turn_error',
			message: 'Rate limit',
			retryable: true,
			code: 429,
		})
		assert.deepEqual(map('turn_error', frame('turn_error', {})), { kind: 'turn_error', message: 'ошибка nessy', retryable: false, code: null })
	})
})
