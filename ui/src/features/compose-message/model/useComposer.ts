/**
 * Логика поля ввода: адресат (явный выбор, «@имя », последний собеседник), отправка, ошибки.
 */
import { useCallback, useMemo, useState } from 'react'
import { api, errorText } from '@/shared/api'
import { YOU, useStore } from '@/shared/model'
import { toast } from '@/shared/ui'
import { defaultRecipient } from '../lib/defaultRecipient'
import { mentionQuery, parseMention, suggest } from '../lib/mention'
import { getLastRecipient, setLastRecipient } from './lastRecipient'
import type { ComposerModel } from './types'

export function useComposer(fixedTo: string | undefined, onSent?: () => void): ComposerModel {
	const agents = useStore(s => s.agents)
	const messages = useStore(s => s.messages)
	const targets = useMemo(() => agents.filter(a => a.status !== 'dead'), [agents])
	const [text, setTextRaw] = useState('')
	const [picked, setPicked] = useState<string | null>(getLastRecipient)
	const [sending, setSending] = useState(false)

	const mention = fixedTo ? null : parseMention(text, targets)
	const recipient = fixedTo ?? mention?.agent.id ?? defaultRecipient(messages, targets, picked)
	const suggestions = fixedTo ? [] : suggest(mentionQuery(text), targets)

	const pick = useCallback((id: string) => {
		setPicked(id)
		setLastRecipient(id)
	}, [])

	const setText = useCallback((v: string) => setTextRaw(v), [])

	const complete = useCallback(
		(agent: { id: string; name: string }) => {
			setTextRaw(`@${agent.name} `)
			pick(agent.id)
		},
		[pick],
	)

	const send = useCallback(async () => {
		const body = (mention ? mention.rest : text).trim()
		if (!body || !recipient || sending) return
		setSending(true)
		try {
			await api.send(recipient, { text: body, from: YOU })
			setTextRaw('')
			if (!fixedTo) pick(recipient)
			onSent?.()
		} catch (e) {
			toast(`Не отправлено: ${errorText(e)}`, 'error')
		} finally {
			setSending(false)
		}
	}, [mention, text, recipient, sending, fixedTo, pick, onSent])

	return { text, setText, recipient, pick, targets, sending, send, suggestions, complete }
}
