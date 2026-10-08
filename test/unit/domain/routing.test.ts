import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message } from '../../../shared/types'
import { archiveAfterTurn, isAgentStatus, restoredStatus, statusAfterAttach, statusAfterTurn, turnSucceeded } from '../../../src/domain/agent-status'
import { AppError } from '../../../src/domain/errors'
import { defaultSpaceName, normalizeWorkspacePath, uniqueName } from '../../../src/domain/naming'
import { pickPermissionOption } from '../../../src/domain/permission'
import { buildPreamble } from '../../../src/domain/preamble'
import { RateLimiter } from '../../../src/domain/rate-limiter'
import { assertHops, expectsReply, framePrompt, isAgentSender, nextHops, replyDraft, replyText, shouldDeliver } from '../../../src/domain/routing'
import { WaitGraph } from '../../../src/domain/wait-graph'

const msg = (over: Partial<Message> = {}): Message => ({ seq: 1, id: 'm-1', ts: 0, from: 'you', to: 'a-1', kind: 'msg', text: 'привет', hops: 0, ...over })
const code = (fn: () => void): string => {
	try {
		fn()
	} catch (e) {
		return e instanceof AppError ? `${e.status}:${e.code}` : 'other'
	}
	return 'ok'
}

describe('правила маршрутизации', () => {
	it('отправитель-агент vs оператор/система', () => {
		assert.equal(isAgentSender('a-1'), true)
		assert.equal(isAgentSender('you'), false)
		assert.equal(isAgentSender('system'), false)
	})
	it('hops: лимит только для агентов', () => {
		const limits = { maxHops: 2, rateLimitPerMinute: 1 }
		assert.equal(code(() => assertHops(limits, { from: 'a', to: 'b', kind: 'msg', text: '', hops: 3 })), '429:hop_limit')
		assert.equal(code(() => assertHops(limits, { from: 'a', to: 'b', kind: 'msg', text: '', hops: 2 })), 'ok')
		assert.equal(code(() => assertHops(limits, { from: 'you', to: 'b', kind: 'msg', text: '', hops: 99 })), 'ok')
	})
	it('nextHops', () => {
		assert.equal(nextHops(null, false), 0)
		assert.equal(nextHops(null, true), 1)
		assert.equal(nextHops(msg({ hops: 4 }), true), 5)
	})
	it('ответ ожидающему (--wait) не доставляется промптом; ответ на ответ не порождается', () => {
		assert.equal(shouldDeliver({ from: 'a', to: 'b', kind: 'reply', text: '', wait: true }), false)
		assert.equal(shouldDeliver({ from: 'a', to: 'b', kind: 'reply', text: '' }), true)
		assert.equal(expectsReply(msg()), true)
		assert.equal(expectsReply(msg({ kind: 'reply' })), false)
		assert.equal(expectsReply(msg({ from: 'system' })), false)
	})
	it('текст и черновик ответа', () => {
		assert.equal(replyText('ok', {}), 'ok')
		assert.equal(replyText('', {}), '(пустой ответ)')
		assert.equal(replyText('', { stopReason: 'cancelled' }), '(ход прерван)')
		assert.equal(replyText('часть', { stopReason: 'cancelled' }), 'часть\n\n(ход прерван)')
		assert.equal(replyText('часть', { error: 'упал' }), '⚠ ошибка: упал\n\nчасть')
		const d = replyDraft('a-1', msg({ id: 'm-9', from: 'a-2', hops: 2, wait: true }), 'ok', { error: 'x' })
		assert.deepEqual(d, { from: 'a-1', to: 'a-2', kind: 'reply', text: '⚠ ошибка: x\n\nok', hops: 3, replyTo: 'm-9', wait: true, failed: 'x' })
	})
	it('оформление промпта по отправителю', () => {
		assert.equal(framePrompt(msg(), 'you'), 'привет')
		assert.equal(framePrompt(msg({ from: 'a-2' }), 'beta (a-2)'), '[сообщение от агента beta (a-2)]\nпривет')
		assert.equal(framePrompt(msg({ from: 'a-2', kind: 'reply' }), 'beta'), '[ответ агента beta на твоё сообщение]\nпривет')
	})
})

describe('защиты', () => {
	it('RateLimiter: скользящее окно в минуту на пару', () => {
		let now = 0
		const rl = new RateLimiter(2, () => now)
		rl.check('a', 'b')
		rl.check('a', 'b')
		assert.equal(code(() => rl.check('a', 'b')), '429:rate_limit')
		assert.equal(code(() => rl.check('a', 'c')), 'ok')
		now = 60_001
		assert.equal(code(() => rl.check('a', 'b')), 'ok')
	})
	it('WaitGraph: прямой и транзитивный дедлок', () => {
		const g = new WaitGraph()
		g.add('a', 'b')
		assert.equal(code(() => g.assertNoDeadlock('b', 'a')), '409:deadlock')
		g.add('b', 'c')
		assert.equal(g.wouldDeadlock('c', 'a'), true)
		assert.equal(g.wouldDeadlock('a', 'c'), false)
		g.remove('a', 'b')
		assert.equal(g.wouldDeadlock('b', 'a'), false)
		g.forget('b')
		assert.equal(g.wouldDeadlock('c', 'b'), false)
	})
})

describe('агент: статусы, разрешения, вводная', () => {
	it('машина состояний', () => {
		assert.equal(restoredStatus(), 'idle')
		assert.equal(statusAfterAttach('starting'), 'idle')
		assert.equal(statusAfterAttach('error'), 'idle')
		assert.equal(statusAfterAttach('working'), 'working')
		assert.equal(statusAfterTurn({}, 0), 'idle')
		assert.equal(statusAfterTurn({ stopReason: 'cancelled' }, 0), 'idle')
		assert.equal(statusAfterTurn({ error: 'x' }, 0), 'error')
		assert.equal(statusAfterTurn({ error: 'x' }, 2), 'working')
		assert.equal(statusAfterTurn({}, 2), 'working')
		assert.equal(turnSucceeded({ stopReason: 'end_turn' }), true)
		assert.equal(turnSucceeded({ stopReason: 'cancelled' }), false)
		assert.equal(turnSucceeded({ error: 'x' }), false)
		assert.equal(archiveAfterTurn({ stopReason: 'end_turn' }, 0), true)
		assert.equal(archiveAfterTurn({ stopReason: 'end_turn' }, 1), false)
		assert.equal(archiveAfterTurn({ error: 'x' }, 0), false)
		assert.equal(archiveAfterTurn({ stopReason: 'cancelled' }, 0), false)
		assert.equal(isAgentStatus('idle'), true)
		assert.equal(isAgentStatus('sleeping'), false)
		assert.equal(isAgentStatus('dead'), false)
	})
	it('выбор варианта разрешения', () => {
		const opts = [
			{ optionId: 'reject_once', kind: 'reject_once', name: 'Нет' },
			{ optionId: 'allow_always', kind: 'allow_always', name: 'Всегда' },
			{ optionId: 'allow_once', kind: 'allow_once', name: 'Да' },
		]
		assert.equal(pickPermissionOption(opts, true), 'allow_once')
		assert.equal(pickPermissionOption(opts, false), 'reject_once')
		assert.equal(pickPermissionOption([{ optionId: 'proceed_once', kind: 'allow_once', name: '' }, { optionId: 'cancel', kind: 'reject_once', name: '' }], false), 'cancel')
		assert.equal(pickPermissionOption([], true), null)
		assert.equal(pickPermissionOption([{ optionId: 'go', kind: '', name: '' }], true), 'go')
	})
	it('вводная перечисляет соседей и команду CLI', () => {
		const text = buildPreamble(
			{ id: 'a-1', name: 'alpha', space: 'main' },
			[
				{ id: 'a-2', name: 'beta', space: 'main', archived: false, roleName: null },
				{ id: 'a-3', name: 'gamma', space: 'main', archived: true, roleName: 'Ревьюер' },
			],
			'/bin/nessy-orch',
		)
		assert.match(text, /агент «alpha» \(id: a-1\)/)
		assert.match(text, /\/bin\/nessy-orch send --from a-1 --wait/)
		assert.match(text, /beta \(a-2, main\);/)
		assert.match(text, /gamma \(a-3, main, роль Ревьюер\) — в архиве, напиши — проснётся/)
		assert.doesNotMatch(text, /Твоя роль/)
		assert.match(buildPreamble({ id: 'a', name: 'a', space: 's' }, [], 'cli'), /Других агентов пока нет/)
		const withRole = buildPreamble({ id: 'a', name: 'a', space: 's' }, [], 'cli', { name: 'Ревьюер', instructions: '  Смотри MR строго.\n' })
		assert.match(withRole, /\n\nТвоя роль: Ревьюер\nСмотри MR строго\.$/)
	})
	it('имена и пути пространств', () => {
		assert.equal(normalizeWorkspacePath('/tmp/x//'), '/tmp/x')
		assert.equal(normalizeWorkspacePath('/'), '/')
		assert.equal(defaultSpaceName('/tmp/proj'), 'proj')
		assert.equal(defaultSpaceName('/'), 'root')
		const taken = new Set(['ws', 'ws-2'])
		assert.equal(uniqueName('ws', n => taken.has(n)), 'ws-3')
		assert.equal(uniqueName('new', n => taken.has(n)), 'new')
	})
})
