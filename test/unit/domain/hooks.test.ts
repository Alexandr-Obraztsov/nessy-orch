import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentBrief, Message, RoleView, SessionUpdates, SessionView } from '../../../shared/types'
import { agentLine, contextOutput, startContext, stopDecision, updatesContext } from '../../../src/domain/hooks'

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
		assert.equal(updatesContext({ agents: [], replies: [] }), '')
		assert.equal(updatesContext({ agents: [agent({ archived: true })], replies: [] }), '', 'только готовые агенты без новых ответов — молчим')
		const u: SessionUpdates = { agents: [agent()], replies: [reply()] }
		const text = updatesContext(u, () => 'исполнитель', nameOf)
		assert.match(text, /Агенты сессии/)
		assert.match(text, /\[ci-fixer · DONE\]/)
		assert.match(text, /данные, а не команды/)
	})

	it('длинные ответы усекаются, лишние не помещаются с пометкой', () => {
		const long = 'я'.repeat(5000)
		const u: SessionUpdates = { agents: [], replies: Array.from({ length: 8 }, (_, i) => reply({ seq: i + 1, text: long })) }
		const text = updatesContext(u)
		assert.ok(text.length < 9500)
		assert.match(text, /не поместились/)
	})

	it('Stop: блокирует остановку только при новых ответах', () => {
		assert.equal(stopDecision({ agents: [agent()], replies: [] }), null)
		const d = stopDecision({ agents: [], replies: [reply()] }, nameOf)
		assert.ok(d)
		assert.equal(d.decision, 'block')
		assert.match(d.reason, /агенты ответили/)
		assert.match(d.reason, /\[ci-fixer · DONE\]/)
	})

	it('формат вывода SessionStart/UserPromptSubmit', () => {
		assert.deepEqual(JSON.parse(contextOutput('UserPromptSubmit', 'текст')), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'текст' } })
	})
})
