import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	CORE_EVENT_TYPES,
	EXT_EVENT_TYPES,
	portEventToSessionEvent,
	sessionEventToPortEvent,
} from '../../../src/application/agent-port'
import type { SessionEvent } from '../../../src/application/ports'

describe('agent-port: маппинг SessionEvent → PortEvent', () => {
	it('текст → message.delta', () => {
		assert.deepEqual(sessionEventToPortEvent({ kind: 'text', text: 'привет', messageId: 'm1' }), {
			type: 'message.delta',
			data: { messageId: 'm1', text: 'привет' },
		})
	})
	it('мысли → thought.delta', () => {
		assert.deepEqual(sessionEventToPortEvent({ kind: 'thought', text: 'хм', messageId: null }), {
			type: 'thought.delta',
			data: { messageId: null, text: 'хм' },
		})
	})
	it('tool в работе → tool_call.started, завершённый → tool_call.completed', () => {
		const inProgress: SessionEvent = { kind: 'tool', toolId: 't1', name: 'grep', title: 'Grep', input: { q: 1 }, status: 'in_progress', output: '' }
		assert.deepEqual(sessionEventToPortEvent(inProgress), { type: 'tool_call.started', data: { toolId: 't1', name: 'grep', input: { q: 1 } } })
		const done: SessionEvent = { kind: 'tool', toolId: 't1', name: 'grep', title: 'Grep', input: {}, status: 'completed', output: 'ok' }
		assert.deepEqual(sessionEventToPortEvent(done), { type: 'tool_call.completed', data: { toolId: 't1', name: 'grep', status: 'completed', output: 'ok' } })
	})
	it('turn_complete → turn.completed, turn_error → turn.failed, cancelled → turn.cancelled', () => {
		assert.deepEqual(sessionEventToPortEvent({ kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p' }), {
			type: 'turn.completed',
			data: { stopReason: 'end_turn', promptId: 'p' },
		})
		assert.deepEqual(sessionEventToPortEvent({ kind: 'turn_error', message: '429', retryable: true, code: 429 }), {
			type: 'turn.failed',
			data: { message: '429', retryable: true, code: 429 },
		})
		assert.deepEqual(sessionEventToPortEvent({ kind: 'cancelled', promptId: 'p' }), { type: 'turn.cancelled', data: { promptId: 'p' } })
	})
	it('permission → permission.requested, plan → plan.updated, injected → mid_turn.injected', () => {
		const options = [{ optionId: 'a', kind: 'allow_once', name: 'Разрешить' }]
		assert.deepEqual(sessionEventToPortEvent({ kind: 'permission', requestId: 'r', options, title: 'Shell' }), {
			type: 'permission.requested',
			data: { requestId: 'r', title: 'Shell', options },
		})
		const entries = [{ content: 'шаг', status: 'pending' as const }]
		assert.deepEqual(sessionEventToPortEvent({ kind: 'plan', entries }), { type: 'plan.updated', data: { entries } })
		assert.deepEqual(sessionEventToPortEvent({ kind: 'injected', count: 2 }), { type: 'mid_turn.injected', data: { count: 2 } })
	})
	it('died → error, внутренние мета (meta/followup/evicted/resync) → null', () => {
		assert.deepEqual(sessionEventToPortEvent({ kind: 'died', reason: 'crash' }), { type: 'error', data: { message: 'процесс агента nessy завершился' } })
		assert.equal(sessionEventToPortEvent({ kind: 'meta', displayName: 'x' }), null)
		assert.equal(sessionEventToPortEvent({ kind: 'followup', text: 'x' }), null)
		assert.equal(sessionEventToPortEvent({ kind: 'evicted' }), null)
		assert.equal(sessionEventToPortEvent({ kind: 'resync' }), null)
	})
})

describe('agent-port: обратный маппинг PortEvent → SessionEvent', () => {
	it('message.delta и thought.delta', () => {
		assert.deepEqual(portEventToSessionEvent({ type: 'message.delta', data: { messageId: 'm1', text: 'x' } }), { kind: 'text', text: 'x', messageId: 'm1' })
		assert.deepEqual(portEventToSessionEvent({ type: 'thought.delta', data: { messageId: null, text: 'y' } }), { kind: 'thought', text: 'y', messageId: null })
	})
	it('tool_call.started/completed', () => {
		assert.deepEqual(portEventToSessionEvent({ type: 'tool_call.started', data: { toolId: 't', name: 'n', input: { a: 1 } } }), {
			kind: 'tool',
			toolId: 't',
			name: 'n',
			title: 'n',
			input: { a: 1 },
			status: 'in_progress',
			output: '',
		})
	})
	it('turn.completed/failed/cancelled', () => {
		assert.deepEqual(portEventToSessionEvent({ type: 'turn.completed', data: { stopReason: 'end_turn', promptId: 'p' } }), {
			kind: 'turn_complete',
			stopReason: 'end_turn',
			promptId: 'p',
		})
		assert.deepEqual(portEventToSessionEvent({ type: 'turn.failed', data: { message: '429', retryable: true, code: 429 } }), {
			kind: 'turn_error',
			message: '429',
			retryable: true,
			code: 429,
		})
		assert.deepEqual(portEventToSessionEvent({ type: 'turn.cancelled', data: { promptId: 'p' } }), { kind: 'cancelled', promptId: 'p' })
	})
	it('tool_call.completed: статус завершения и output', () => {
		assert.deepEqual(portEventToSessionEvent({ type: 'tool_call.completed', data: { toolId: 't', name: 'n', status: 'failed', output: 'boom' } }), {
			kind: 'tool',
			toolId: 't',
			name: 'n',
			title: 'n',
			input: {},
			status: 'failed',
			output: 'boom',
		})
	})
	it('permission.requested и plan.updated', () => {
		const options = [{ optionId: 'a', kind: 'allow_once', name: 'Разрешить' }]
		assert.deepEqual(portEventToSessionEvent({ type: 'permission.requested', data: { requestId: 'r', title: 'Shell', options } }), {
			kind: 'permission',
			requestId: 'r',
			title: 'Shell',
			options,
		})
		const entries = [{ content: 'шаг', status: 'completed' }]
		assert.deepEqual(portEventToSessionEvent({ type: 'plan.updated', data: { entries } }), { kind: 'plan', entries: [{ content: 'шаг', status: 'completed' }] })
	})
	it('mid_turn.injected', () => {
		assert.deepEqual(portEventToSessionEvent({ type: 'mid_turn.injected', data: { count: 3 } }), { kind: 'injected', count: 3 })
	})
	it('не покрытые контрактом события → null (error, session.ready и др.)', () => {
		assert.equal(portEventToSessionEvent({ type: 'error', data: { message: 'x' } }), null)
		assert.equal(portEventToSessionEvent({ type: 'session.ready', data: { sessionId: 's' } }), null)
		assert.equal(portEventToSessionEvent({ type: 'model.switched', data: { model: 'm' } }), null)
	})
})

describe('agent-port: константы контракта', () => {
	it('ровно 11 обязательных core-событий', () => {
		assert.deepEqual(CORE_EVENT_TYPES, [
			'session.ready',
			'turn.started',
			'message.delta',
			'message.completed',
			'tool_call.started',
			'tool_call.completed',
			'turn.completed',
			'turn.failed',
			'turn.cancelled',
			'error',
			'session.closed',
		])
	})
	it('10 опциональных ext-событий (plan.updated и tool_call.delta остаются контрактными, в P0–P3 не реализуются)', () => {
		assert.deepEqual(EXT_EVENT_TYPES, [
			'permission.requested',
			'permission.resolved',
			'tool_call.delta',
			'thought.delta',
			'plan.updated',
			'model.switched',
			'model.switch_failed',
			'mid_turn.injected',
			'context.usage',
			'user_message.delta',
		])
	})
})