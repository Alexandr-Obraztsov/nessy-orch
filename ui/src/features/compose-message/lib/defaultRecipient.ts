import type { AgentView, Message } from '@contract'

/** Агент, с которым оператор переписывался последним (иначе — первый доступный). */
export function defaultRecipient(messages: Message[], targets: AgentView[], remembered: string | null): string | null {
	const ok = (id: string | null | undefined): id is string => !!id && targets.some(a => a.id === id)
	if (ok(remembered)) return remembered
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (!m || m.kind === 'event') continue
		const other = m.from === 'you' ? m.to : m.to === 'you' ? m.from : null
		if (ok(other)) return other
	}
	return targets[0]?.id ?? null
}
