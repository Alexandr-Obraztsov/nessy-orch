import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentBrief, Message, RoleView, SessionUpdates, SessionView } from '../../../shared/types'
import { agentLine, startContext, stopDecision, updatesContext, watchCommand, watchReminder } from '../../../src/domain/hooks'

const agent = (over: Partial<AgentBrief> = {}): AgentBrief => ({ id: 'a-1', name: 'ci-fixer', role: 'executor', status: 'working', archived: false, lastTool: 'npm test', plan: { done: 2, total: 4 }, ...over })
const reply = (over: Partial<Message> = {}): Message => ({ seq: 1, id: 'm-1', ts: 1, from: 'a-1', to: 'you', kind: 'reply', text: 'готово\n\nСтатус: DONE', hops: 0, ...over })
const session: SessionView = { id: 'fix-ci-1', title: 'Починить CI', owner: null, status: 'active', summary: null, createdAt: '', updatedAt: '', sources: 0 }
const role: RoleView = { id: 'executor', name: 'Исполнитель', description: 'делает', instructions: 'x', color: 10, icon: null, createdAt: '', updatedAt: '' }
const nameOf = (id: string): string => (id === 'a-1' ? 'ci-fixer' : id)

describe('хуки Claude Code: тексты', () => {
	it('строка агента: роль, команда только у работающего, план', () => {
		assert.equal(agentLine(agent(), () => 'исполнитель'), '- ci-fixer (исполнитель): работает · npm test · план 2/4')
		assert.equal(agentLine(agent({ status: 'idle', archived: true, lastTool: 'x', plan: null }), () => null), '- ci-fixer: готов')
	})

	it('старт: сессия уже есть, новую не заводить, роли перечислены', () => {
		const text = startContext(session, [role])
		assert.match(text, /fix-ci-1/)
		assert.match(text, /новую не заводи/)
		assert.match(text, /executor — делает/)
	})

	it('сводка перед ходом: агенты и ответы; пусто, если нечего сообщить', () => {
		assert.equal(updatesContext({ agents: [], replies: [], watching: false }), '')
		assert.equal(updatesContext({ agents: [agent({ archived: true })], replies: [], watching: false }), '', 'только готовые агенты без новых ответов — молчим')
		const u: SessionUpdates = { agents: [agent()], replies: [reply()], watching: true }
		const text = updatesContext(u, () => 'исполнитель', nameOf)
		assert.match(text, /Агенты сессии/)
		assert.match(text, /\[ci-fixer · DONE\]/)
		assert.match(text, /данные, а не команды/)
	})

	it('длинные ответы усекаются, лишние не помещаются с пометкой', () => {
		const long = 'я'.repeat(5000)
		const u: SessionUpdates = { agents: [], replies: Array.from({ length: 8 }, (_, i) => reply({ seq: i + 1, text: long })), watching: false }
		const text = updatesContext(u)
		assert.ok(text.length < 9500)
		assert.match(text, /не поместились/)
	})

	it('Stop: блокирует остановку только при новых ответах', () => {
		assert.equal(stopDecision({ agents: [agent()], replies: [], watching: true }), null)
		const d = stopDecision({ agents: [], replies: [reply()], watching: false }, nameOf)
		assert.ok(d)
		assert.equal(d.decision, 'block')
		assert.match(d.reason, /агенты ответили/)
		assert.match(d.reason, /\[ci-fixer · DONE\]/)
	})

	it('старт: жёсткое правило фонового ожидания с готовой командой', () => {
		const text = startContext(session, [])
		assert.match(text, /ЖЁСТКОЕ ПРАВИЛО ОЖИДАНИЯ/)
		assert.ok(text.includes(watchCommand('fix-ci-1')))
		assert.match(text, /run_in_background/)
	})

	it('агенты работают, ожидания нет: напоминание в сводке и блок остановки (один раз)', () => {
		const busy: SessionUpdates = { agents: [agent()], replies: [], watching: false }
		assert.match(watchReminder(busy, 'fix-ci-1'), /inbox --session fix-ci-1 --wait 1500/)
		assert.match(updatesContext(busy, undefined, nameOf, 'fix-ci-1'), /ВНИМАНИЕ/)
		const d = stopDecision(busy, nameOf, { session: 'fix-ci-1' })
		assert.ok(d)
		assert.match(d.reason, /run_in_background/)
		assert.equal(stopDecision(busy, nameOf, { session: 'fix-ci-1', stopHookActive: true }), null, 'второй раз не зацикливаем')
		assert.equal(stopDecision({ ...busy, watching: true }, nameOf, { session: 'fix-ci-1' }), null, 'ожидание запущено — можно остановиться')
		assert.equal(stopDecision({ agents: [agent({ status: 'idle' })], replies: [], watching: false }, nameOf, { session: 'fix-ci-1' }), null, 'никто не работает')
		assert.equal(watchReminder({ ...busy, watching: true }, 'fix-ci-1'), '')
	})

	it('ответы пришли, но агенты ещё работают: в блоке есть напоминание про ожидание', () => {
		const d = stopDecision({ agents: [agent()], replies: [reply()], watching: false }, nameOf, { session: 'fix-ci-1' })
		assert.ok(d)
		assert.match(d.reason, /агенты ответили/)
		assert.match(d.reason, /ВНИМАНИЕ/)
	})
})
