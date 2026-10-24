import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderAgentEvent, renderStreamEvent } from '../../../../src/interfaces/cli/render-event'
import type { StreamEvent } from '../../../../shared/types'

const seq = { seq: 1, ts: 1700000000000 }

describe('CLI renderAgentEvent', () => {
	it('text — с маркером и отступом', () => {
		const out = renderAgentEvent({ ...seq, kind: 'text', text: 'ответ\nвторая строка' })
		assert.match(out, /▸/)
		assert.match(out, / {4}вторая строка/)
	})
	it('tool — имя и статус', () => {
		const out = renderAgentEvent({ ...seq, kind: 'tool', toolId: 't1', name: 'grep_search', title: 'поиск', input: {}, status: 'completed' })
		assert.match(out, /⚙ grep_search/)
		assert.match(out, /completed/)
	})
	it('system error — красный маркер', () => {
		assert.match(renderAgentEvent({ ...seq, kind: 'system', level: 'error', text: 'упало' }), /!/)
	})
	it('thought — приглушён', () => {
		assert.match(renderAgentEvent({ ...seq, kind: 'thought', text: 'думаю' }), /думаю/)
	})
	it('user — отправитель и текст', () => {
		const out = renderAgentEvent({ ...seq, kind: 'user', from: 'a-1', msgId: 'm1', text: 'вопрос' })
		assert.match(out, /← a-1/)
		assert.match(out, /вопрос/)
	})
	it('permission разрешено автоматически', () => {
		const out = renderAgentEvent({ ...seq, kind: 'permission', requestId: 'r1', title: 'разрешить', resolved: true, approved: true, auto: true })
		assert.match(out, /разрешено автоматически/)
	})
	it('permission отклонено', () => {
		const out = renderAgentEvent({ ...seq, kind: 'permission', requestId: 'r2', title: 'разрешить', resolved: true, approved: false })
		assert.match(out, /отклонено/)
	})
	it('permission ждёт решения', () => {
		const out = renderAgentEvent({ ...seq, kind: 'permission', requestId: 'r3', title: 'разрешить', resolved: false })
		assert.match(out, /ждёт решения/)
	})
	it('system info — приглушён, без «!»', () => {
		const out = renderAgentEvent({ ...seq, kind: 'system', level: 'info', text: 'заметка' })
		assert.match(out, /· заметка/)
		assert.ok(!out.includes('!'))
	})
})

describe('CLI renderStreamEvent', () => {
	it('message — строка ленты', () => {
		const out = renderStreamEvent({ t: 'message', rev: 1, message: { seq: 1, id: 'm1', ts: 1, from: 'a-1', to: 'you', kind: 'msg', text: 'привет', hops: 0 } })
		assert.match(out, /a-1/)
		assert.match(out, /привет/)
	})
	it('agent — статус', () => {
		const agent = { id: 'a-1', name: 'a-1', status: 'working' }
		const ev: StreamEvent = { t: 'agent', rev: 1, agent: agent as never }
		assert.match(renderStreamEvent(ev), /working/)
	})
	it('snapshot — счётчики', () => {
		const ev: StreamEvent = { t: 'snapshot', rev: 1, spaces: [], agents: [], roles: [], sessions: [], messages: [] }
		assert.match(renderStreamEvent(ev), /агентов 0/)
	})
	it('agent_removed — id', () => {
		assert.match(renderStreamEvent({ t: 'agent_removed', rev: 1, id: 'a-1' }), /агент удалён a-1/)
	})
	it('space — имя и статус', () => {
		const space: StreamEvent = {
			t: 'space',
			rev: 1,
			space: { name: 'ws', path: '/ws', color: 210, mode: 'managed', url: null, status: 'ready', error: null, runtime: 'nessy-sdk' },
		}
		const out = renderStreamEvent(space)
		assert.match(out, /пространство ws ready/)
	})
	it('space_removed — имя', () => {
		assert.match(renderStreamEvent({ t: 'space_removed', rev: 1, name: 'ws' }), /пространство удалено ws/)
	})
	it('role — id и имя', () => {
		const role: StreamEvent = {
			t: 'role',
			rev: 1,
			role: { id: 'dev', name: 'Разработчик', description: '', instructions: '', color: 200, icon: null, createdAt: '', updatedAt: '' },
		}
		const out = renderStreamEvent(role)
		assert.match(out, /роль dev Разработчик/)
	})
	it('role_removed — id', () => {
		assert.match(renderStreamEvent({ t: 'role_removed', rev: 1, id: 'dev' }), /роль удалена dev/)
	})
	it('session — id и статус', () => {
		const session: StreamEvent = {
			t: 'session',
			rev: 1,
			session: { id: 's1', title: 'сессия', owner: null, status: 'active', summary: null, createdAt: '', updatedAt: '', sources: 0 },
		}
		const out = renderStreamEvent(session)
		assert.match(out, /сессия s1 active/)
	})
	it('session_removed — id', () => {
		assert.match(renderStreamEvent({ t: 'session_removed', rev: 1, id: 's1' }), /сессия удалена s1/)
	})
})
