/**
 * Начало текущего вызова инструмента. Сервер отдаёт только последний инструмент и число вызовов
 * за ход (turnSteps), без времени начала, поэтому засекаем сами: смена (ход, номер вызова) —
 * новый инструмент, таймер с нуля. Впервые увиденный (после загрузки страницы) инструмент
 * считаем начатым в момент последней активности агента.
 */
import type { AgentView } from '@contract'

const seen = new Map<string, { key: string; since: number }>()

export function toolStartedAt(a: Pick<AgentView, 'id' | 'turnStartedAt' | 'turnSteps' | 'lastActivityAt'>, now: number): number {
	const key = `${a.turnStartedAt ?? ''}|${a.turnSteps}`
	const hit = seen.get(a.id)
	if (hit?.key === key) return hit.since
	const last = Date.parse(a.lastActivityAt)
	const since = hit ? now : Math.min(now, Number.isNaN(last) ? now : last)
	seen.set(a.id, { key, since })
	return since
}
