/** Выбранная вкладка для каждого агента — в памяти, на время сессии. */
import { useCallback, useState } from 'react'
import type { DetailTab } from './types'

const memory = new Map<string, DetailTab>()

/** Явно выбранная вкладка агента или null (тогда — вкладка по умолчанию). */
export function useTabMemory(agentId: string): [DetailTab | null, (t: DetailTab) => void] {
	const [tab, setTab] = useState<DetailTab | null>(() => memory.get(agentId) ?? null)
	const choose = useCallback(
		(t: DetailTab) => {
			memory.set(agentId, t)
			setTab(t)
		},
		[agentId],
	)
	return [tab, choose]
}
