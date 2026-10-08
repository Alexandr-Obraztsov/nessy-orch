/**
 * Удаление пространства и роли с подтверждением. Пространство с агентами сервер не удаляет (409) —
 * тогда предлагаем удалить вместе с агентами (force).
 */
import { useState } from 'react'
import type { RoleView, SpaceView } from '@contract'
import { ApiFailure, api, errorText } from '@/shared/api'
import { closeTabsWhere, getState } from '@/shared/model'
import { toast } from '@/shared/ui'

export function useRemoveSpace() {
	const [target, setTarget] = useState<SpaceView | null>(null)
	const [force, setForce] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const ask = (sp: SpaceView): void => {
		setTarget(sp)
		// с агентами сервер откажет (409) — сразу спрашиваем про удаление вместе с ними
		setForce(getState().agents.some(a => a.space === sp.name))
		setError(null)
	}
	const cancel = (): void => setTarget(null)
	const run = async (): Promise<void> => {
		if (!target) return
		setBusy(true)
		setError(null)
		try {
			await api.removeSpace(target.name, force)
			toast(`Пространство «${target.name}» удалено`, 'success')
			setTarget(null)
		} catch (e) {
			if (!force && e instanceof ApiFailure && e.status === 409) {
				setForce(true)
				setError(e.message)
			} else setError(errorText(e))
		} finally {
			setBusy(false)
		}
	}
	return { target, force, busy, error, ask, cancel, run }
}

export function useRemoveRole() {
	const [target, setTarget] = useState<RoleView | null>(null)
	const [busy, setBusy] = useState(false)
	const run = async (): Promise<void> => {
		if (!target) return
		setBusy(true)
		try {
			await api.removeRole(target.id)
			closeTabsWhere(t => t.kind === 'role' && t.id === target.id)
			toast(`Роль «${target.name}» удалена`, 'success')
			setTarget(null)
		} catch (e) {
			toast(`Не удалось удалить роль: ${errorText(e)}`, 'error')
		} finally {
			setBusy(false)
		}
	}
	return { target, busy, ask: setTarget, cancel: () => setTarget(null), run }
}
