/**
 * Удаление пространства в два шага: подтверждение → запрос; если сервер ответил 409
 * (в пространстве есть агенты) — предлагаем удалить вместе с агентами (force).
 */
import { useState } from 'react'
import { ApiFailure, api, errorText } from '@/shared/api'
import { toast } from '@/shared/ui'
import type { RemoveStage } from './types'

export function useRemoveSpace(name: string, onDone: () => void) {
	const [stage, setStage] = useState<RemoveStage>('idle')
	const [error, setError] = useState<string | null>(null)

	const run = async (force: boolean): Promise<void> => {
		setStage(force ? 'forceBusy' : 'busy')
		setError(null)
		try {
			await api.removeSpace(name, force)
			toast(`Пространство «${name}» удалено`, 'success')
			onDone()
		} catch (e) {
			if (!force && e instanceof ApiFailure && e.status === 409) {
				setStage('force')
				setError(e.message)
				return
			}
			setStage(force ? 'force' : 'confirm')
			setError(errorText(e))
		}
	}

	return {
		stage,
		error,
		ask: () => setStage('confirm'),
		cancel: () => {
			setStage('idle')
			setError(null)
		},
		confirm: () => void run(false),
		force: () => void run(true),
	}
}
