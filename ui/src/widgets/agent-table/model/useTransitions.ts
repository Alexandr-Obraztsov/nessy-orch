/**
 * Недавние переходы состояний агентов — для анимаций, которых нет в данных сервера:
 *   закончил задачу → строка ещё HOLD_MS стоит в «Работают» (бар добивается до 100 %, галочка
 *   дорисовывается), затем переезжает в «Выполнено» с меткой «новое» на FRESH_MS;
 *   получил разрешение → короткая зелёная подсветка строки.
 * Переходы считаются во время рендера по смене массива агентов (без лишнего кадра «не там»).
 */
import { useEffect, useReducer, useRef } from 'react'
import type { AgentView } from '@contract'
import { agentState, type AgentState } from '@/entities/agent'
import type { Transitions } from './types'

const HOLD_MS = 1500
const FRESH_MS = 9000
const FLASH_MS = 900

interface Memory {
	src: AgentView[] | null
	prev: Map<string, AgentState>
	done: Map<string, number>
	ok: Map<string, number>
}

export function useTransitions(agents: AgentView[]): Transitions {
	const mem = useRef<Memory>({ src: null, prev: new Map(), done: new Map(), ok: new Map() })
	const [, rerender] = useReducer((x: number) => x + 1, 0)
	const m = mem.current
	const now = Date.now()

	if (m.src !== agents) {
		// первый снапшот — без анимаций: всё, что уже выполнено, сразу на своём месте
		const first = m.src === null
		for (const a of agents) {
			const st = agentState(a)
			const was = m.prev.get(a.id)
			if (!first && was !== undefined && was !== 'done' && st === 'done') m.done.set(a.id, now)
			if (st !== 'done') m.done.delete(a.id)
			if (!first && was === 'wait' && st === 'working') m.ok.set(a.id, now)
			m.prev.set(a.id, st)
		}
		m.src = agents
	}

	// перерисовать, когда истечёт ближайшая задержка
	useEffect(() => {
		let next = Infinity
		const t = Date.now()
		for (const at of m.done.values()) for (const d of [HOLD_MS, FRESH_MS]) if (at + d > t) next = Math.min(next, at + d)
		for (const at of m.ok.values()) if (at + FLASH_MS > t) next = Math.min(next, at + FLASH_MS)
		if (next === Infinity) return
		const timer = window.setTimeout(rerender, next - t + 16)
		return () => window.clearTimeout(timer)
	})

	const within = (src: Map<string, number>, ms: number): Set<string> => {
		const out = new Set<string>()
		for (const [id, at] of src) if (now - at < ms) out.add(id)
		return out
	}
	return { held: within(m.done, HOLD_MS), fresh: within(m.done, FRESH_MS), flash: within(m.ok, FLASH_MS) }
}
