/**
 * Сводка оркестратора (/status): версия, авто-разрешения. Запрашивается при каждом
 * (пере)подключении потока — этого достаточно, данные почти статичны.
 */
import { useEffect, useState } from 'react'
import type { StatusResponse } from '@contract'
import { api } from '@/shared/api'
import { useStore } from '@/shared/model'

export function useOrchStatus(): StatusResponse | null {
	const conn = useStore(s => s.conn)
	const [status, setStatus] = useState<StatusResponse | null>(null)
	useEffect(() => {
		if (conn !== 'live') return
		let alive = true
		api.status().then(
			s => alive && setStatus(s),
			() => undefined,
		)
		return () => {
			alive = false
		}
	}, [conn])
	return status
}
