import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildForest, renderTree } from '../../../../src/interfaces/cli/tree'
import type { AgentView } from '../../../../shared/types'

const base: AgentView = {
	id: 'a-1',
	name: 'a-1',
	title: null,
	space: 'ws',
	session: null,
	parent: 'you',
	role: null,
	status: 'idle',
	archived: false,
	parked: false,
	error: null,
	displayName: null,
	createdAt: '',
	lastActivityAt: '',
	queued: 0,
	turnStartedAt: null,
	lastTool: null,
	preview: '',
	pendingPermissions: [],
	plan: null,
	turnSteps: 0,
	lastTurnMs: null,
	lastReply: null,
	stats: { turns: 0, toolCalls: 0, workMs: 0, tokens: null, contextPct: null },
}

function agent(over: Partial<AgentView>): AgentView {
	return { ...base, ...over }
}

describe('CLI buildForest', () => {
	it('top-level — агенты с родителем you, субагенты — под своим родителем', () => {
		const forest = buildForest([
			agent({ id: 'a-1', parent: 'you' }),
			agent({ id: 'a-2', parent: 'a-1' }),
			agent({ id: 'a-3', parent: 'a-1' }),
			agent({ id: 'a-4', parent: 'you' }),
		])
		assert.equal(forest.length, 2)
		assert.deepEqual(
			forest.map(n => n.agent.id),
			['a-1', 'a-4'],
		)
		assert.deepEqual(
			forest[0]?.children.map(n => n.agent.id),
			['a-2', 'a-3'],
		)
	})

	it('агент с родителем вне списка — корень леса', () => {
		const forest = buildForest([agent({ id: 'x', parent: 'nonexistent' })])
		assert.equal(forest.length, 1)
		assert.equal(forest[0]?.agent.id, 'x')
	})
})

describe('CLI renderTree', () => {
	it('пустое дерево — подсказка', () => {
		const out = renderTree([], 'you')
		assert.match(out, /активных агентов нет/)
	})

	it('две ветки с субагентами и метаданными', () => {
		const forest = buildForest([
			agent({
				id: 'a-1',
				parent: 'you',
				status: 'working',
				stats: { turns: 1, toolCalls: 2, workMs: 300, tokens: null, contextPct: 12 },
				...{ runtime: 'nessy-sdk', model: 'glm' },
			}),
			agent({ id: 'a-2', parent: 'a-1', status: 'idle', ...{ runtime: 'tclaude', model: 'sonnet' } }),
			agent({ id: 'a-3', parent: 'you', status: 'error' }),
		])
		const out = renderTree(forest, 'you')
		const lines = out.split('\n')
		assert.equal(lines[0], 'you')
		assert.match(lines[1] ?? '', /├─ a-1/)
		assert.match(lines[1] ?? '', /nessy-sdk · glm/)
		assert.match(lines[1] ?? '', /12%/)
		assert.match(lines[2] ?? '', /│ {2}└─ a-2/)
		assert.match(lines[2] ?? '', /tclaude · sonnet/)
		assert.match(lines[3] ?? '', /└─ a-3/)
	})

	it('без runtime/model — прочерк', () => {
		const forest = buildForest([agent({ id: 'a-1', parent: 'you' })])
		assert.match(renderTree(forest, 'you'), /—/)
	})
})
