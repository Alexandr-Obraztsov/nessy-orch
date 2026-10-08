import { useCallback, useMemo, useState } from 'react'
import type { AgentView } from '@contract'
import { canCancel } from '@/entities/agent'
import { archiveAgent, cancelTurn, copyText, removeAgent, restoreAgent } from './actions'
import { askRemove } from './confirm'
import type { AgentActionsApi } from './types'

/** Действия над агентом для кнопок и меню (шапка чата, строка в списке, граф). */
export function useAgentActions(agent: AgentView): AgentActionsApi {
	const [busy, setBusy] = useState(false)
	const { id, name } = agent

	const wrap = useCallback(async (fn: () => Promise<boolean>): Promise<boolean> => {
		setBusy(true)
		try {
			return await fn()
		} finally {
			setBusy(false)
		}
	}, [])

	const cancel = useCallback(() => wrap(() => cancelTurn(id)), [wrap, id])
	const archive = useCallback(() => wrap(() => archiveAgent(id, name)), [wrap, id, name])
	const restore = useCallback(() => wrap(() => restoreAgent(id, name)), [wrap, id, name])
	const remove = useCallback(
		async (confirm = true): Promise<boolean> => {
			if (confirm) {
				askRemove(agent)
				return false
			}
			return wrap(() => removeAgent(id, name))
		},
		[wrap, agent, id, name],
	)
	const copyId = useCallback(() => copyText(id, `id скопирован: ${id}`), [id])

	return useMemo(
		() => ({ cancel, archive, restore, remove, copyId, busy, cancellable: canCancel(agent.status) }),
		[cancel, archive, restore, remove, copyId, busy, agent.status],
	)
}
