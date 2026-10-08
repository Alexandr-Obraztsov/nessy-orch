/**
 * Правила маршрутизации сообщений (чистые функции, без IO):
 *  1. you → агент (msg): доставка агенту; по завершении хода ответ уходит в `you` (reply).
 *  2. агент A → агент B (msg): доставка B; по завершении хода ответ автоматически уходит A (reply).
 *     Если A отправил с wait=true — ответ вернётся в его shell-вызов и НЕ дублируется ему промптом.
 *  3. Ход, вызванный reply, ответа не порождает (иначе пинг-понг). Дальше агенты общаются явным `send`.
 *  4. Защиты: лимит длины цепочки (hops), лимит сообщений в минуту на пару, детектор дедлоков для wait.
 */
import type { Message } from '../../shared/types'
import { SYSTEM, YOU } from './constants'
import { AppError } from './errors'
import type { MessageDraft, RoutingLimits, TurnOutcome } from './types'

/** Отправитель — агент (а не оператор или система): к нему применяются защиты. */
export function isAgentSender(from: string): boolean {
	return from !== YOU && from !== SYSTEM
}

/** Проверить длину цепочки агент→агент. */
export function assertHops(limits: RoutingLimits, draft: MessageDraft): void {
	if (!isAgentSender(draft.from)) return
	if ((draft.hops ?? 0) > limits.maxHops)
		throw new AppError(
			429,
			'hop_limit',
			`цепочка сообщений длиннее ${limits.maxHops} — вероятно, зацикливание; сообщение отклонено`,
		)
}

/** hops нового сообщения: от оператора — 0, от агента — на 1 больше, чем у сообщения, которое он обрабатывает. */
export function nextHops(senderCurrent: Message | null, fromAgent: boolean): number {
	return fromAgent ? (senderCurrent?.hops ?? 0) + 1 : 0
}

/** Доставлять ли сообщение адресату промптом: ответ ожидающему (wait) приходит в вызов, а не промптом. */
export function shouldDeliver(draft: MessageDraft): boolean {
	return !(draft.kind === 'reply' && draft.wait)
}

/** Порождает ли ход по этому сообщению ответ отправителю. */
export function expectsReply(msg: Message): boolean {
	return msg.kind !== 'reply' && msg.from !== SYSTEM
}

/** Текст ответа по итогу хода. */
export function replyText(text: string, outcome: TurnOutcome): string {
	if (outcome.error) return `⚠ ошибка: ${outcome.error}${text ? `\n\n${text}` : ''}`
	if (!text && outcome.stopReason === 'cancelled') return '(ход прерван)'
	return text || '(пустой ответ)'
}

/** Черновик ответа агента `agentId` на сообщение `msg`. */
export function replyDraft(agentId: string, msg: Message, text: string, outcome: TurnOutcome): MessageDraft {
	const draft: MessageDraft = {
		from: agentId,
		to: msg.from,
		kind: 'reply',
		text: replyText(text, outcome),
		hops: msg.hops + 1,
		replyTo: msg.id,
	}
	if (msg.wait) draft.wait = true
	if (outcome.error) draft.failed = outcome.error
	return draft
}

/** Оформить входящее сообщение как текст промпта (с указанием отправителя-агента). */
export function framePrompt(msg: Message, senderLabel: string): string {
	if (msg.from === YOU) return msg.text
	return msg.kind === 'reply'
		? `[ответ агента ${senderLabel} на твоё сообщение]\n${msg.text}`
		: `[сообщение от агента ${senderLabel}]\n${msg.text}`
}
