/** SSE: общий поток /stream и поток агента /agents/:id/stream (реплей + живой блок). */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AgentEvent, AgentStreamEvent, ChunkEvent, StreamEvent } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 25000 }
const isStream = (e: unknown): e is StreamEvent => typeof e === 'object' && e !== null && 't' in e
const isAgentStream = (e: unknown): e is AgentStreamEvent => typeof e === 'object' && e !== null && 't' in e

describe('SSE-потоки', () => {
	let h: Harness
	before(async () => {
		h = await startHarness()
		await h.api('POST', '/spaces', { path: h.ws, name: 'main' })
	})
	after(() => h.close())

	it('/stream: снапшот, затем агенты, сообщения, пространства; без событий чата', T, async () => {
		const s = await h.sse('/stream')
		try {
			const snap = await s.waitFor((e): e is Extract<StreamEvent, { t: 'snapshot' }> => isStream(e) && e.t === 'snapshot')
			assert.deepEqual(
				snap.spaces.map(x => x.name),
				['main'],
			)
			assert.deepEqual(snap.agents, [])
			assert.deepEqual(snap.roles, [])
			await h.api('POST', '/agents', { space: 'main', name: 'streamer', prompt: 'эй', wait: true })
			await s.waitFor((e): e is StreamEvent => isStream(e) && e.t === 'message' && e.message.kind === 'reply', 8000, 'reply в /stream')
			const ts = s.events.filter(isStream).map(e => e.t)
			assert.ok(ts.includes('agent'))
			assert.ok(ts.includes('space'), 'статус пространства (starting/ready)')
			assert.ok(!s.events.some(e => isStream(e) && (e.t as string) === 'event'))
			assert.ok(!s.events.some(e => isStream(e) && (e.t as string) === 'chunk'))
			const revs = s.events.filter(isStream).map(e => e.rev)
			assert.deepEqual(
				revs.slice(1),
				[...revs.slice(1)].sort((a, b) => a - b),
				'rev монотонен',
			)
		} finally {
			s.close()
		}
	})

	it('/agents/:id/stream: история, состояние агента, replay_done, затем живые события', T, async () => {
		const s = await h.sse('/agents/streamer/stream')
		try {
			await s.waitFor((e): e is AgentStreamEvent => isAgentStream(e) && e.t === 'replay_done')
			const replay = s.events.filter(isAgentStream)
			const done = replay.findIndex(e => e.t === 'replay_done')
			assert.ok(replay.slice(0, done).some(e => e.t === 'event' && e.event.kind === 'user'))
			assert.equal(replay[done - 1]?.t, 'agent')
			await h.api('POST', '/agents/streamer/send', { text: 'живой' })
			await s.waitFor((e): e is AgentStreamEvent => isAgentStream(e) && e.t === 'event' && e.event.kind === 'text' && e.event.text === 'ответ: живой', 8000, 'текст')
			const live = s.events.filter(isAgentStream).slice(done + 1)
			assert.ok(live.some(e => e.t === 'chunk' && e.chunk.kind === 'text'))
			assert.ok(live.some(e => e.t === 'chunk' && e.chunk.kind === 'thought'))
		} finally {
			s.close()
		}
	})

	it('подключение посреди хода: незавершённый блок приходит одним chunk до replay_done и не дублируется', T, async () => {
		await h.api('POST', '/agents/streamer/send', { text: '#long' })
		const agent = h.orch.resolveAgent('streamer')
		await until(() => (agent.liveRun()?.kind === 'text' && (agent.liveRun()?.text.length ?? 0) > 40), 8000, 'текст стримится')
		const s = await h.sse('/agents/streamer/stream')
		try {
			await s.waitFor((e): e is AgentStreamEvent => isAgentStream(e) && e.t === 'replay_done')
			const events = s.events.filter(isAgentStream)
			const done = events.findIndex(e => e.t === 'replay_done')
			const replayChunks = events.slice(0, done).filter((e): e is { t: 'chunk'; chunk: ChunkEvent } => e.t === 'chunk')
			assert.equal(replayChunks.length, 1, 'ровно один chunk в реплее')
			const first = replayChunks[0]?.chunk
			assert.ok(first)
			assert.equal(first.kind, 'text')
			assert.equal(first.len, first.delta.length)
			assert.ok(first.delta.startsWith('## План проверки'))
			const replayEvents = events.slice(0, done).filter((e): e is { t: 'event'; event: AgentEvent } => e.t === 'event')
			assert.ok(!replayEvents.some(e => e.event.seq === first.seq), 'живой блок не дублируется в истории')
			// дальше чанки того же блока продолжают его: len растёт от delta реплея
			await s.waitFor((e): e is AgentStreamEvent => isAgentStream(e) && e.t === 'event' && e.event.kind === 'text' && e.event.seq === first.seq, 10000, 'блок закрыт')
			const tail = events.length
			const all = s.events.filter(isAgentStream)
			const cont = all.slice(done + 1).filter((e): e is { t: 'chunk'; chunk: ChunkEvent } => e.t === 'chunk' && e.chunk.seq === first.seq)
			assert.ok(cont.length > 0 && tail > 0)
			const rebuilt = first.delta + cont.map(c => c.chunk.delta).join('')
			const final = all.find((e): e is { t: 'event'; event: AgentEvent } => e.t === 'event' && e.event.seq === first.seq)
			assert.equal(final?.event.kind === 'text' ? final.event.text : '', rebuilt)
			assert.match(rebuilt, /\| Компонент \| Статус \| Комментарий \|/)
			assert.match(rebuilt, /```ts/)
		} finally {
			s.close()
		}
		await until(() => h.orch.getAgent('streamer').status === 'idle', 8000, 'ход завершён')
	})

	it('/history включает незавершённый блок (для CLI show)', T, async () => {
		await h.api('POST', '/agents/streamer/send', { text: '#long' })
		const agent = h.orch.resolveAgent('streamer')
		await until(() => agent.liveRun()?.kind === 'text', 8000, 'текст стримится')
		const live = agent.liveRun()
		const hist = await h.api<AgentEvent[]>('GET', '/agents/streamer/history')
		assert.ok(hist.body.some(e => e.seq === live?.seq && e.kind === 'text'))
		await h.api('POST', '/agents/streamer/cancel', {})
		await until(() => h.orch.getAgent('streamer').status === 'idle', 8000, 'прерван')
	})

	it('поток несуществующего агента → 404', T, async () => {
		const s = await h.sse('/agents/nope/stream')
		s.close()
		assert.equal(s.status, 404)
	})
})
