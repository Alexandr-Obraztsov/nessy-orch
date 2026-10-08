/**
 * Непрочитанное в ленте: сообщения (не от оператора и не системные события),
 * пришедшие после последнего открытия вкладки «Лента». История из снапшота
 * при первой загрузке считается прочитанной.
 */
import { useEffect, useMemo, useState } from 'react'
import { YOU, useStore } from '@/shared/model'

export function useFeedUnread(active: boolean): number {
	const messages = useStore(s => s.messages)
	const lastSeq = messages[messages.length - 1]?.seq ?? 0
	const [seen, setSeen] = useState<number | null>(null)

	// первая порция данных — точка отсчёта; на вкладке — всё прочитано
	useEffect(() => {
		if (seen === null ? lastSeq > 0 : active) setSeen(lastSeq)
	}, [active, lastSeq, seen])

	return useMemo(() => {
		if (seen === null || active) return 0
		let n = 0
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]
			if (!m || m.seq <= seen) break
			if (m.from !== YOU && m.kind !== 'event') n++
		}
		return n
	}, [messages, seen, active])
}
