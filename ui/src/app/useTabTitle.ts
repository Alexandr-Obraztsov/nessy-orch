import { useEffect, useMemo } from 'react'
import { countStates } from '@/entities/agent'
import { useStore } from '@/shared/model'

/** Заголовок вкладки: «(3) nessy-orch», где 3 — запросы разрешений и ошибки (требуют внимания). */
export function useTabTitle(): void {
	const agents = useStore(st => st.agents)
	const n = useMemo(() => {
		const c = countStates(agents)
		return c.wait + c.error
	}, [agents])
	useEffect(() => {
		document.title = n > 0 ? `(${n}) nessy-orch` : 'nessy-orch'
	}, [n])
}
