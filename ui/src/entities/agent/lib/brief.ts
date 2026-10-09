/**
 * Поручение агента — то, что ему дали: первое сообщение ему (от оркестратора, иначе от кого угодно).
 * Чистые функции — без React и стора.
 */
import type { AgentView, Message } from '@contract'

const YOU = 'you'

/** Первое сообщение каждому агенту: от вас, иначе от кого угодно (ключ — id получателя). */
export function firstMessages(messages: Message[]): Map<string, Message> {
	const fromYou = new Map<string, Message>()
	const any = new Map<string, Message>()
	for (const m of messages) {
		if (m.kind !== 'msg') continue
		if (!any.has(m.to)) any.set(m.to, m)
		if (m.from === YOU && !fromYou.has(m.to)) fromYou.set(m.to, m)
	}
	for (const [id, m] of any) if (!fromYou.has(id)) fromYou.set(id, m)
	return fromYou
}

/** Текст поручения для карточки: без markdown-разметки, абзацы — через пробел. */
export function plainBrief(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, ' … ')
		.split('\n')
		.map(l =>
			l
				.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?)/, '')
				.replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
				.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
				.trim(),
		)
		.filter(Boolean)
		.join('\n')
}

/** Поручение агента: первое сообщение ему, иначе имя сессии / превью. */
export function briefOf(a: AgentView, first: Map<string, Message>): string {
	const m = first.get(a.id)
	return (m && plainBrief(m.text)) || a.displayName || plainBrief(a.preview) || ''
}
