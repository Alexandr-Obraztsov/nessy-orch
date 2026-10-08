import type { AgentView, Message } from '@contract'

/**
 * Адресат по умолчанию: выбранный явно; иначе последний активный собеседник из ленты;
 * иначе первый активный агент; иначе последний собеседник из архива.
 */
export function defaultRecipient(messages: Message[], agents: AgentView[], remembered: string | null): string | null {
	const find = (id: string | null | undefined): AgentView | undefined => (id ? agents.find(a => a.id === id) : undefined)
	if (find(remembered)) return remembered
	let archivedPeer: string | null = null
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (!m || m.kind === 'event') continue
		const other = m.from === 'you' ? m.to : m.to === 'you' ? m.from : null
		const a = find(other)
		if (!a) continue
		if (!a.archived) return a.id
		archivedPeer ??= a.id
	}
	return agents.find(a => !a.archived)?.id ?? archivedPeer ?? agents[0]?.id ?? null
}
