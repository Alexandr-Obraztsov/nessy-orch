/**
 * FakeAgentPort — детерминированная реализация AgentPort для тестов ядра и conformance-сьюта (§10 дизайна).
 * Синтезирует обязательные core-события из собственных действий (разрешено §3 «Правило происхождения»):
 * create → session.ready на подписке; prompt → turn.started → message.delta → message.completed → turn.completed
 * (для «#cancel» → turn.cancelled, для «#error» → turn.failed); cancel → turn.cancelled; close → session.closed.
 */
import type { AgentPort, Capabilities, Envelope, PortEvent, PortSubscription, PortSubscribeOptions } from '../../src/application/agent-port'

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

interface FakeSession {
	id: string
	subscriber: PortEventListener | null
	ready: boolean
	seq: number
}

export class FakeAgentPort implements AgentPort {
	readonly capabilities: Capabilities = { streamText: true, midTurn: true, permissionVote: true, setModel: true }

	private seq = 0
	private readonly sessions = new Map<string, FakeSession>()

	async sessionCreate(): Promise<{ sessionId: string }> {
		await delay(0)
		const sessionId = `fake_${this.sessions.size + 1}`
		this.sessions.set(sessionId, { id: sessionId, subscriber: null, ready: false, seq: 0 })
		return { sessionId }
	}

	async sessionResume(sessionId: string): Promise<{ lastSeq: number | null } | null> {
		await delay(0)
		if (!this.sessions.has(sessionId)) return null
		const s = this.ensure(sessionId)
		s.ready = false
		return { lastSeq: s.seq }
	}

	async promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		await delay(0)
		const s = this.ensure(sessionId)
		this.emit(s, { type: 'turn.started', data: { promptId: null } })
		// «#cancel»/«#hang» — держим ход открытым до promptCancel (для теста отмены)
		if (text.trim().startsWith('#cancel') || text.trim().startsWith('#hang')) return { promptId: 'p_hang' }
		// «#perm» — запрашиваем разрешение и держим ход открытым до голоса (для теста permission.vote)
		if (text.trim().startsWith('#perm')) {
			this.emit(s, {
				type: 'permission.requested',
				data: { requestId: 'perm_1', title: 'Выполнить команду', options: [{ optionId: 'allow', kind: 'allow_once', name: 'Разрешить' }] },
			})
			return { promptId: 'p_perm' }
		}
		if (text.trim().startsWith('#error')) {
			this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'ошибка' } })
			void delay(5).then(() => this.emit(s, { type: 'turn.failed', data: { message: 'ошибка хода', retryable: true, code: 429 } }))
			return { promptId: 'p_err' }
		}
		this.emit(s, { type: 'message.delta', data: { messageId: 'm1', text: 'ответ: ' + text } })
		void delay(5).then(() => {
			this.emit(s, { type: 'message.completed', data: { messageId: 'm1', text: 'ответ: ' + text } })
			this.emit(s, { type: 'turn.completed', data: { stopReason: 'end_turn', promptId: 'p' } })
		})
		return { promptId: 'p' }
	}

	async promptCancel(sessionId: string): Promise<void> {
		await delay(0)
		const s = this.ensure(sessionId)
		this.emit(s, { type: 'turn.cancelled', data: { promptId: null } })
	}

	async permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		await delay(0)
		this.emit(this.ensure(sessionId), { type: 'permission.resolved', data: { requestId, optionId } })
	}

	async midTurnSend(sessionId: string, _message: string): Promise<boolean> {
		await delay(0)
		this.emit(this.ensure(sessionId), { type: 'mid_turn.injected', data: { count: 1 } })
		return true
	}

	async sessionClose(sessionId: string): Promise<void> {
		await delay(0)
		const s = this.ensure(sessionId)
		this.emit(s, { type: 'session.closed', data: { sessionId } })
		this.sessions.delete(sessionId)
	}

	async modelSet(sessionId: string, model: string): Promise<void> {
		await delay(0)
		this.emit(this.ensure(sessionId), { type: 'model.switched', data: { model } })
	}

	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription {
		const s = this.ensure(sessionId)
		s.subscriber = opts.onEvent
		if (!s.ready) {
			s.ready = true
			opts.onEvent(this.wrap(sessionId, { type: 'session.ready', data: { sessionId } }))
		}
		return {
			close(): void {
				if (s.subscriber === opts.onEvent) s.subscriber = null
			},
		}
	}

	private ensure(sessionId: string): FakeSession {
		let s = this.sessions.get(sessionId)
		if (!s) {
			s = { id: sessionId, subscriber: null, ready: false, seq: 0 }
			this.sessions.set(sessionId, s)
		}
		return s
	}

	private emit(s: FakeSession, port: PortEvent): void {
		s.subscriber?.(this.wrap(s.id, port))
	}

	private wrap(sessionId: string, port: PortEvent): Envelope {
		this.seq += 1
		return { v: 1, sessionId, seq: this.seq, ts: Date.now(), originatorClientId: null, type: port.type, data: port.data }
	}
}

type PortEventListener = (envelope: Envelope) => void