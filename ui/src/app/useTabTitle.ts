import { useEffect } from 'react'
import { useStore } from '@/shared/model'

/** Заголовок вкладки: «(2) nessy-orch», где 2 — запросы разрешений, ждущие вас. */
export function useTabTitle(): void {
	const n = useStore(st => st.agents.reduce((k, a) => k + a.pendingPermissions.length, 0))
	useEffect(() => {
		document.title = n > 0 ? `(${n}) nessy-orch` : 'nessy-orch'
	}, [n])
}
