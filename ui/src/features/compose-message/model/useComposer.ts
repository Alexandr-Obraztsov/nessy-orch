/**
 * Логика поля ввода: адресат (явный выбор, «@имя », последний собеседник), отправка, ошибки.
 * Сообщение от вас сервер по умолчанию доставляет сразу, прерывая текущий ход агента;
 * агент из архива при этом просыпается с прежним контекстом.
 */
import { useCallback, useMemo, useState } from 'react'
import type { AgentView } from '@contract'
import { api, errorText } from '@/shared/api'
import { YOU, useStore } from '@/shared/model'
import { toast } from '@/shared/ui'
import { defaultRecipient } from '../lib/defaultRecipient'
import { mentionQuery, parseMention, suggest } from '../lib/mention'
import { getLastRecipient, setLastRecipient } from './lastRecipient'
import type { ComposerModel } from './types'

export function useComposer(fixedTo: string | undefined, onSent?: () => void, interruptToggle = false): ComposerModel {
	const agents = useStore(s => s.agents)
	const messages = useStore(s => s.messages)
	const active = useMemo(() => agents.filter(a => !a.archived), [agents])
	const archived = useMemo(() => agents.filter(a => a.archived), [agents])
	const [text, setTextRaw] = useState('')
	const [picked, setPicked] = useState<string | null>(getLastRecipient)
	const [sending, setSending] = useState(false)
	const [interrupt, setInterrupt] = useState(true)

	const mention = fixedTo ? null : parseMention(text, agents)
	const recipientId = fixedTo ?? mention?.agent.id ?? defaultRecipient(messages, agents, picked)
	const recipient = agents.find(a => a.id === recipientId) ?? null
	const suggestions = fixedTo ? [] : suggest(mentionQuery(text), agents)
	const body = (mention ? mention.rest : text).trim()
	const canSend = !!recipient && body.length > 0 && !sending

	const pick = useCallback((id: string) => {
		setPicked(id)
		setLastRecipient(id)
	}, [])

	const setText = useCallback((v: string) => setTextRaw(v), [])

	const complete = useCallback(
		(agent: AgentView) => {
			setTextRaw(`@${agent.name} `)
			pick(agent.id)
		},
		[pick],
	)

	const send = useCallback(async () => {
		if (!canSend) return
		setSending(true)
		try {
			// галочку учитываем, только пока адресат работает: свободному агенту сообщение доставляется сразу
			const busy = recipient.status === 'working' || recipient.status === 'starting'
			await api.send(recipient.id, interruptToggle && busy ? { text: body, from: YOU, interrupt } : { text: body, from: YOU })
			setTextRaw('')
			if (!fixedTo) pick(recipient.id)
			onSent?.()
		} catch (e) {
			toast(`Не отправлено: ${errorText(e)}`, 'error')
		} finally {
			setSending(false)
		}
	}, [canSend, recipient, body, fixedTo, pick, onSent, interruptToggle, interrupt])

	return { text, setText, recipient, pick, active, archived, sending, canSend, interrupt, setInterrupt, send, suggestions, complete }
}
