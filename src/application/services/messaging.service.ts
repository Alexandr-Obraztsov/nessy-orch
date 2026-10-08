/** Отправка и маршрутизация сообщений (правила — domain/routing.ts). */
import type { Message, SendRequest, SendResponse } from '../../../shared/types'
import { SYSTEM, YOU } from '../../domain/constants'
import { AppError } from '../../domain/errors'
import { RateLimiter } from '../../domain/rate-limiter'
import { assertHops, expectsReply, isAgentSender, nextHops, replyDraft, shouldDeliver } from '../../domain/routing'
import type { AgentIdentity, MessageDraft, TurnOutcome } from '../../domain/types'
import { WaitGraph } from '../../domain/wait-graph'
import type { ServiceContext } from './context.types'

const DEFAULT_WAIT_SEC = 600

export class MessagingService {
	private readonly limiter: RateLimiter
	private readonly waitGraph = new WaitGraph()

	constructor(private readonly ctx: ServiceContext) {
		this.limiter = new RateLimiter(ctx.settings.rateLimitPerMinute, () => ctx.clock.now())
	}

	/** Системная запись в ленте (создание/удаление агентов, ошибки доставки). */
	postEvent(text: string, about?: string): Message {
		return this.ctx.feed.append({ from: SYSTEM, to: about ?? SYSTEM, kind: 'event', text })
	}

	/**
	 * Записать сообщение в ленту и доставить адресату. Единая точка входа для всех маршрутов.
	 * interrupt — прервать текущий ход адресата и доставить сообщение вне очереди.
	 */
	post(draft: MessageDraft, interrupt = false): Message {
		if (draft.to === YOU) return this.ctx.feed.append(draft)
		const target = this.ctx.registry.agents.get(draft.to)
		if (!target) throw new AppError(404, 'no_agent', `агент «${draft.to}» не найден`)
		if (isAgentSender(draft.from)) {
			assertHops(this.ctx.settings, draft)
			this.limiter.check(draft.from, draft.to)
		}
		const msg = this.ctx.feed.append(draft)
		if (shouldDeliver(draft)) target.deliver(msg, interrupt)
		return msg
	}

	/**
	 * Отправить сообщение агенту (или `you`) от `you` или от другого агента; опционально дождаться ответа.
	 * Сообщение от you по умолчанию прерывает текущий ход адресата, от агента — встаёт в очередь.
	 */
	async send(ref: string, req: SendRequest): Promise<SendResponse> {
		const { registry } = this.ctx
		const text = req.text.trim()
		if (!text) throw new AppError(400, 'empty_text', 'text обязателен')
		const to = ref === YOU ? YOU : registry.resolveAgent(ref).id
		const from = registry.resolveSender(req.from)
		if (from === to) throw new AppError(400, 'self_send', 'нельзя отправить сообщение самому себе')

		const wait = !!req.wait
		if (wait && from !== YOU && to !== YOU) this.waitGraph.assertNoDeadlock(from, to)
		const sender = from === YOU ? null : (registry.agents.get(from) ?? null)
		const hops = nextHops(sender?.currentMessage ?? null, sender !== null)

		const interrupt = req.interrupt ?? from === YOU
		const message = this.post({ from, to, kind: 'msg', text, hops, wait }, interrupt)
		if (!wait) return { message }
		return this.waitReply(message, from, to, req.waitTimeoutSec)
	}

	private async waitReply(message: Message, from: string, to: string, timeoutSec?: number): Promise<SendResponse> {
		const timeoutMs = Math.max(1, timeoutSec ?? DEFAULT_WAIT_SEC) * 1000
		if (from !== YOU) this.waitGraph.add(from, to)
		try {
			const reply = await this.ctx.feed.waitReply(message.id, timeoutMs)
			return reply ? { message, reply } : { message, timedOut: true }
		} finally {
			this.waitGraph.remove(from, to)
		}
	}

	forget(agentId: string): void {
		this.waitGraph.forget(agentId)
	}

	// ---------- коллбэки агентов ----------
	onTurnDone(agent: AgentIdentity, msg: Message, text: string, outcome: TurnOutcome): Message | null {
		if (!expectsReply(msg)) return null // ответы на ответы не порождаем
		const reply = this.ctx.feed.append(replyDraft(agent.id, msg, text, outcome))
		const back = this.ctx.registry.agents.get(msg.from)
		if (back && !msg.wait) back.deliver(reply)
		return reply
	}
}
