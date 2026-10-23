/**
 * FakeAgentPort — детерминированная реализация AgentPort для тестов ядра и conformance-сьюта (§10 дизайна).
 * Является и тестовым стендом интеграционных тестов (развитие fake-nessy): в autoRespond-режиме реагирует на
 * сценарные команды, как делал фейковый nessy serve, но события шлёт через порт (Envelope) прямо агенту.
 *
 * Режимы:
 *  - autoRespond=true (по умолчанию): операции сами эмитят события. promptSend разыгрывает сценарные команды:
 *    «#slow»/«#hang» держат ход открытым до отмены, «#perm <cmd>» — permission.requested→голос→инструмент,
 *    «#shell <cmd>» — инструмент без спроса, «#error» — turn.failed, «#tools»/«#plan»/«#long» — многошаговые сценарии,
 *    «#work …» — план с permission-шагами, «#relay …» — запуск CLI, «Статус:…» — ответ «Принято…», остальное — эхо.
 *  - autoRespond=false (для unit-тестов ядра): операции только записывают факт, события присылает тест методом emit().
 *
 * emit() принимает нативные SessionEvent и нормализует их в контрактные события порта (sessionEventToPortEvent).
 */
import type { AgentPort, Capabilities, Envelope, PortEvent, PortSubscription, PortSubscribeOptions } from '../../src/application/agent-port'
import { sessionEventToPortEvent } from '../../src/application/agent-port'
import type { SessionEvent } from '../../src/application/ports'
import { NessyBusyError } from '../../src/domain/errors'
import { ScenarioPlayer, type FakeSession } from './fake-agent-port-scenarios'

const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** сквозной счётчик сессий в пределах процесса: после рестарта (новый порт) id не повторяются. */
let sessionSeq = 0

export interface FakeAgentPortOptions {
	/** автоответ на промпт; false — только manual emit() (тесты ядра). По умолчанию true. */
	autoRespond?: boolean
	/** шаг между событиями сценария, мс (по умолчанию 10). */
	stepMs?: number
}

export class FakeAgentPort implements AgentPort {
	readonly capabilities: Capabilities = { streamText: true, midTurn: true, permissionVote: true, setModel: true }

	// ---------- контроль теста ----------
	prompts: string[] = []
	votes: Array<{ requestId: string; optionId: string | null }> = []
	cancels = 0
	closed: string[] = []
	restored: string[] = []
	midTurns: string[] = []
	created = 0
	/** id созданных в этом порту сессий в порядке создания (для тестов, где id не должны хардкодиться — счётчик общий на процесс). */
	createdIds: string[] = []
	subscribedFrom: Array<{ sessionId: string; lastSeq: number | null }> = []
	promptGate: Promise<void> | null = null
	busyPrompts = 0
	busySessions = 0
	failCreate = 0
	sessionDelayMs = 0
	acceptMidTurn = false
	canRestore = true

	private seq = 0
	private readonly autoRespond: boolean
	private readonly stepMs: number
	private readonly scenarios: ScenarioPlayer
	private readonly sessions = new Map<string, FakeSession>()
	/** сессии, созданные в этом порту (живут и после закрытия — для резюма; в новом порту их нет). */
	private readonly known = new Set<string>()

	constructor(opts: FakeAgentPortOptions = {}) {
		this.autoRespond = opts.autoRespond ?? true
		this.stepMs = opts.stepMs ?? 10
		// в autoRespond-режиме (интеграция/conformance) mid-turn в идущий ход принимается, как у настоящего рантайма
		this.acceptMidTurn = opts.autoRespond ?? true
		this.scenarios = new ScenarioPlayer((s, port) => this.emitPort(s, port), this.stepMs)
	}

	async sessionCreate(): Promise<{ sessionId: string }> {
		if (this.failCreate > 0) {
			this.failCreate--
			throw new Error('nessy недоступен')
		}
		if (this.busySessions > 0) {
			this.busySessions--
			throw new NessyBusyError('unavailable', 'nessy POST /session → 503: session_limit_exceeded', 5)
		}
		this.created++
		if (this.sessionDelayMs > 0) await delay(this.sessionDelayMs)
		const sessionId = `s-${++sessionSeq}`
		this.createdIds.push(sessionId)
		this.sessions.set(sessionId, { id: sessionId, subscriber: null, ready: false, permissions: new Map(), hang: false, named: false })
		this.known.add(sessionId)
		return { sessionId }
	}

	async sessionResume(sessionId: string): Promise<{ lastSeq: number | null } | null> {
		await delay(0)
		this.restored.push(sessionId)
		// резюм только для сессий ЭТОГО порта (после рестарта старой сессии в новом порту нет → создаётся новая)
		if (!this.canRestore || !this.known.has(sessionId)) return null
		const s = this.ensure(sessionId)
		s.ready = false
		return { lastSeq: 7 }
	}

	async promptSend(sessionId: string, text: string): Promise<{ promptId: string | null }> {
		await delay(0)
		this.prompts.push(text)
		if (this.busyPrompts > 0) {
			this.busyPrompts--
			throw new NessyBusyError('queue_full', 'nessy POST /prompt → 503: prompt_queue_full', 5)
		}
		const promptId = `p-${this.prompts.length}`
		if (this.promptGate) await this.promptGate
		if (this.autoRespond) {
			const s = this.ensure(sessionId)
			s.hang = false
			this.emitPort(s, { type: 'turn.started', data: { promptId: null } })
			this.scenarios.play(s, text)
		}
		return { promptId }
	}

	async promptCancel(sessionId: string): Promise<void> {
		this.cancels++
		await delay(0)
		const s = this.ensure(sessionId)
		if (s.hang) {
			s.hang = false
			this.emitPort(s, { type: 'turn.cancelled', data: { promptId: null } })
		}
	}

	async permissionVote(sessionId: string, requestId: string, optionId: string | null): Promise<void> {
		await delay(0)
		this.votes.push({ requestId, optionId })
		const s = this.ensure(sessionId)
		const resolve = s.permissions.get(requestId)
		if (resolve) {
			s.permissions.delete(requestId)
			resolve(optionId !== null && optionId !== 'deny' && optionId !== 'cancel')
		}
		if (this.autoRespond) this.emitPort(s, { type: 'permission.resolved', data: { requestId, optionId } })
	}

	midTurnSend(sessionId: string, message: string): Promise<boolean> {
		if (!this.acceptMidTurn) return Promise.resolve(false)
		this.midTurns.push(message)
		// модель «забирает» сообщение с задержкой: до неё ход можно отменить/перезапустить и сообщение вернётся в очередь
		setTimeout(() => {
			const s = this.sessions.get(sessionId)
			if (s) this.emitPort(s, { type: 'mid_turn.injected', data: { count: 1 } })
		}, 300)
		return Promise.resolve(true)
	}

	async sessionClose(sessionId: string): Promise<void> {
		await delay(0)
		this.closed.push(sessionId)
		const s = this.ensure(sessionId)
		if (this.autoRespond) this.emitPort(s, { type: 'session.closed', data: { sessionId } })
		this.sessions.delete(sessionId)
	}

	async modelSet(sessionId: string, model: string): Promise<void> {
		await delay(0)
		if (this.autoRespond) this.emitPort(this.ensure(sessionId), { type: 'model.switched', data: { model } })
	}

	subscribe(sessionId: string, opts: PortSubscribeOptions): PortSubscription {
		const s = this.ensure(sessionId)
		s.subscriber = opts.onEvent
		this.subscribedFrom.push({ sessionId, lastSeq: opts.lastSeq ?? null })
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

	/** Прислать нативные SessionEvent всем подписанным сессиям; нормализуются в события порта. */
	emit(...events: SessionEvent[]): void {
		for (const ev of events) {
			const port = sessionEventToPortEvent(ev)
			if (!port) continue
			const envelope = this.wrap(null, port)
			for (const s of this.sessions.values()) s.subscriber?.(envelope)
		}
	}

	private ensure(sessionId: string): FakeSession {
		let s = this.sessions.get(sessionId)
		if (!s) {
			s = { id: sessionId, subscriber: null, ready: false, permissions: new Map(), hang: false, named: false }
			this.sessions.set(sessionId, s)
		}
		return s
	}

	private emitPort(s: FakeSession, port: PortEvent): void {
		s.subscriber?.(this.wrap(s.id, port))
	}

	private wrap(sessionId: string | null, port: PortEvent): Envelope {
		this.seq += 1
		return { v: 1, sessionId, seq: this.seq, ts: Date.now(), originatorClientId: null, type: port.type, data: port.data }
	}
}
