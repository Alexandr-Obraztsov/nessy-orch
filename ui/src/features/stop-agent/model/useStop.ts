import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '@/shared/api'
import { toast } from '@/shared/ui'
import type { StopModel } from './types'

const ARM_MS = 2600

/**
 * «Остановить» — прервать текущий ход агента (POST /agents/:id/cancel).
 * Защита от случайного клика: первый клик спрашивает «Точно?», второй (в течение 2.6 с) останавливает.
 */
export function useStop(agentId: string): StopModel {
	const [armed, setArmed] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!armed) return
		const t = window.setTimeout(() => setArmed(false), ARM_MS)
		return () => window.clearTimeout(t)
	}, [armed])

	const press = useCallback(() => {
		if (!armed) {
			setArmed(true)
			return
		}
		setArmed(false)
		setBusy(true)
		api.cancel(agentId).then(
			() => {
				setBusy(false)
				toast('Ход остановлен', 'success', 2000)
			},
			(e: unknown) => {
				setBusy(false)
				toast(`Не удалось остановить: ${errorText(e)}`, 'error')
			},
		)
	}, [armed, agentId])

	return { armed, busy, press }
}
