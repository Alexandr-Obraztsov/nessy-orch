/**
 * Задача агента — то, что ему поручили: первая строка первого сообщения ему
 * (от вас/оркестратора, иначе от кого угодно). Чистые функции — без React и стора.
 */
import type { AgentView, Message } from '@contract'

const YOU = 'you'
const TITLE_MAX = 160

/** Заголовок из текста задачи: первая непустая строка без markdown-маркеров. */
export function titleFromText(text: string): string {
	for (const raw of text.split('\n')) {
		const line = raw
			.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
			.replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
			.trim()
		if (line) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
	}
	return ''
}

/** Первое сообщение каждому агенту: отдельно от вас и от кого угодно (ключ — id получателя). */
export function firstMessages(messages: Message[]): { fromYou: Map<string, Message>; any: Map<string, Message> } {
	const fromYou = new Map<string, Message>()
	const any = new Map<string, Message>()
	for (const m of messages) {
		if (m.kind !== 'msg') continue
		if (!any.has(m.to)) any.set(m.to, m)
		if (m.from === YOU && !fromYou.has(m.to)) fromYou.set(m.to, m)
	}
	return { fromYou, any }
}

/** Задачи всех агентов: id агента → заголовок (если сообщения уже нет в ленте — имя сессии или превью). */
export function taskTitles(agents: AgentView[], first: ReturnType<typeof firstMessages>): Map<string, string> {
	const out = new Map<string, string>()
	for (const a of agents) {
		const msg = first.fromYou.get(a.id) ?? first.any.get(a.id)
		out.set(a.id, (msg && titleFromText(msg.text)) || a.displayName || titleFromText(a.preview) || '—')
	}
	return out
}
