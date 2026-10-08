import { useEffect, useMemo, useRef } from 'react'
import { agentById, useStore } from '@/shared/model'
import { toast } from '@/shared/ui'
import { attentionTitle, deriveAttention } from '../lib/derive'
import { markSeen, useMarks } from './marks'
import type { AttentionItem, AttentionList } from './types'

/** «Внимание» (реактивно). */
export function useAttention(): AttentionList {
	const agents = useStore(s => s.agents)
	const marks = useMarks()
	return useMemo(() => deriveAttention(agents, marks), [agents, marks])
}

/** Счётчик внимания в заголовке вкладки браузера. */
export function useAttentionTitle(count: number): void {
	useEffect(() => {
		document.title = attentionTitle(count)
	}, [count])
}

/** Открытый агент: его ответ считается просмотренным. */
export function useMarkSeen(agentId: string | null): void {
	const msgId = useStore(s => (agentId ? (s.agents.find(a => a.id === agentId)?.lastReply?.msgId ?? null) : null))
	useEffect(() => {
		if (msgId) markSeen(msgId)
	}, [msgId])
}

const name = (it: AttentionItem): string => agentById(it.agent.id)?.name ?? it.agent.name

/**
 * Всплывашки только для новых запросов разрешений и ошибок; одинаковые склеиваются («+N»).
 * Результаты не всплывают — они тихо попадают во «Внимание». То, что было при загрузке, не показываем.
 */
export function useAttentionToasts(list: AttentionList): void {
	const conn = useStore(s => s.conn)
	const known = useRef<Set<string> | null>(null)
	useEffect(() => {
		if (conn !== 'live') return
		const cur = [...list.permissions, ...list.errors]
		if (known.current === null) {
			known.current = new Set(cur.map(i => i.key))
			return
		}
		const seen = known.current
		const fresh = cur.filter(i => !seen.has(i.key))
		known.current = new Set(cur.map(i => i.key))
		const perms = fresh.filter(i => i.kind === 'permission')
		const errs = fresh.filter(i => i.kind === 'error')
		const first = perms[0]
		if (first) toast(`${name(first)} просит разрешение: ${first.text}`, 'warn', 6000, 'attention:permission', perms.length)
		const err = errs[0]
		if (err) toast(`${name(err)}: ${err.text}`, 'error', 6000, 'attention:error', errs.length)
	}, [list, conn])
}
