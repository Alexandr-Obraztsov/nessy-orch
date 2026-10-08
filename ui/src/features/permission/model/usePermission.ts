import { useCallback, useState } from 'react'
import { api, errorText } from '@/shared/api'
import { toast } from '@/shared/ui'
import type { PermissionChoice, PermissionModel } from './types'

/** Разрешить / отклонить запрос агента. */
export function usePermission(agentId: string, requestId: string): PermissionModel {
	const [busy, setBusy] = useState<PermissionChoice | null>(null)
	const resolve = useCallback(
		async (choice: PermissionChoice) => {
			setBusy(choice)
			try {
				await api.permission(agentId, requestId, choice === 'approve')
			} catch (e) {
				toast(`Не удалось ответить на запрос: ${errorText(e)}`, 'error')
			} finally {
				setBusy(null)
			}
		},
		[agentId, requestId],
	)
	return { busy, resolve }
}
