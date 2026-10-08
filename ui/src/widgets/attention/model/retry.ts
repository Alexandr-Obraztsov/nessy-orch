/**
 * «Повторить» для упавшего хода: повторно отправить агенту последнее сообщение от вас
 * (если его нет — последнее сообщение агенту от кого угодно, но уже от вашего имени).
 */
import type { Message } from '@contract'
import { api, errorText } from '@/shared/api'
import { getState } from '@/shared/model'
import { toast } from '@/shared/ui'

export function lastMessageTo(messages: Message[], agentId: string): Message | undefined {
	let any: Message | undefined
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (!m || m.kind !== 'msg' || m.to !== agentId) continue
		if (m.from === 'you') return m
		any ??= m
	}
	return any
}

export async function retryLast(agentId: string): Promise<void> {
	const m = lastMessageTo(getState().messages, agentId)
	if (!m) {
		toast('Нечего повторять: сообщений этому агенту нет в журнале', 'error')
		return
	}
	try {
		await api.send(agentId, { from: 'you', text: m.text, interrupt: true })
	} catch (e) {
		toast(`Не удалось повторить: ${errorText(e)}`, 'error')
	}
}
