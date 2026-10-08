/**
 * Сводка оркестратора (/status): версия, авто-разрешения. Запрашивается при каждом
 * (пере)подключении потока — данные почти статичны. Одна копия на приложение.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { StatusResponse } from '@contract'
import { api } from '@/shared/api'
import { useStore } from './store'

let status: StatusResponse | null = null
let loading = false
const listeners = new Set<() => void>()

function refresh(): void {
	if (loading) return
	loading = true
	api.status().then(
		s => {
			status = s
			loading = false
			for (const fn of listeners) fn()
		},
		() => {
			loading = false
		},
	)
}

export function useOrchStatus(): StatusResponse | null {
	const conn = useStore(s => s.conn)
	useEffect(() => {
		if (conn === 'live') refresh()
	}, [conn])
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => status,
	)
}
