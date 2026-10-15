import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseContextUsage, parseStats } from '../../../src/infrastructure/nessy/usage'

// ответы живого `nessy serve` (из usage-raw.log), сокращённые
const STATS = {
	v: 1,
	models: {
		'tgpt/deepseek-v4-flash-0731': { tokens: { prompt: 170894, candidates: 1002, total: 171896, cached: 151552, thoughts: 0 } },
		'tgpt/qwen36-35b-a3b-fp8': { tokens: { prompt: 1152, candidates: 25, total: 1177, cached: 576, thoughts: 0 } },
	},
	tools: { totalCalls: 5 },
}
const CTX = { v: 1, usage: { modelName: 'tgpt/deepseek-v4-flash-0731', totalTokens: 35061, contextWindowSize: 524000, breakdown: { freeSpace: 410339 } } }

describe('ответы nessy: токены и контекст', () => {
	it('/stats: суммы по всем моделям сессии', () => {
		assert.deepEqual(parseStats(STATS), { input: 172046, output: 1027, cached: 152128, total: 173073 })
	})
	it('/context-usage: занято и размер окна — как отдал nessy', () => {
		assert.deepEqual(parseContextUsage(CTX), { used: 35061, size: 524000 })
	})
	it('другая форма или пустые данные — null, без догадок и значений по умолчанию', () => {
		assert.equal(parseStats({ session: { tokens: { inputTokens: 5 } } }), null)
		assert.equal(parseStats({ models: {} }), null)
		assert.equal(parseContextUsage({ usage: { totalTokens: 100 } }), null)
		assert.equal(parseContextUsage({ usage: { contextWindowSize: 524000 } }), null)
		assert.equal(parseContextUsage(null), null)
	})
})
