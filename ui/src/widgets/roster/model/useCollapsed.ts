/**
 * Свёрнутые группы ростера (запоминаются в localStorage — это удобство одного зрителя).
 */
import { useCallback, useState } from 'react'

const KEY = 'nessy-orch:roster-collapsed'

function load(): Set<string> {
	try {
		const raw = localStorage.getItem(KEY)
		const arr: unknown = raw ? JSON.parse(raw) : []
		return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
	} catch {
		return new Set()
	}
}

export function useCollapsed(): [Set<string>, (key: string) => void] {
	const [set, setSet] = useState(load)
	const toggle = useCallback((key: string): void => {
		setSet(prev => {
			const next = new Set(prev)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			try {
				localStorage.setItem(KEY, JSON.stringify([...next]))
			} catch {
				/* хранилище недоступно — состояние живёт до перезагрузки */
			}
			return next
		})
	}, [])
	return [set, toggle]
}
