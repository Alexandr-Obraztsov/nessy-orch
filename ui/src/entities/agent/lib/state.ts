/**
 * Отображаемое состояние агента (UI v3): одна иконка и одна подпись на агента.
 * Порядок важности: ждёт вас (разрешение) → ошибка → работает → запуск → готово → пауза.
 */
import type { AgentView } from '@contract'
import { plural } from '@/shared/lib/plural'
import type { AgentAction, AgentState } from './state.types'

export function agentState(a: Pick<AgentView, 'status' | 'archived' | 'pendingPermissions' | 'lastReply'>): AgentState {
	if (a.pendingPermissions.length > 0) return 'wait'
	if (a.status === 'error') return 'error'
	if (a.status === 'working') return 'working'
	if (a.status === 'starting') return 'starting'
	// свободен: ответил вам или ушёл в архив — готово, иначе пауза
	return a.archived || a.lastReply ? 'done' : 'idle'
}

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
	wait: 'ждёт вас',
	error: 'ошибка',
	working: 'работает',
	starting: 'запуск',
	idle: 'пауза',
	done: 'готово',
}

/** Агент сейчас что-то делает (таймер хода идёт). */
export const isActiveState = (s: AgentState): boolean => s === 'working' || s === 'starting' || s === 'wait'

/** Текущее действие агента одной строкой (строка поручения, «Сейчас»). */
export function currentAction(a: AgentView): AgentAction {
	const st = agentState(a)
	switch (st) {
		case 'wait':
			return { text: `просит разрешение: ${a.pendingPermissions[0]?.title ?? ''}`, tone: 'wait' }
		case 'error':
			return { text: a.error ?? a.lastReply?.failed ?? 'ход завершился ошибкой', tone: 'error' }
		case 'working':
			return a.lastTool ? { text: a.lastTool.title || a.lastTool.name, tone: 'muted' } : { text: 'думает…', tone: 'muted' }
		case 'starting':
			return { text: 'запуск…', tone: 'muted' }
		case 'done':
			return { text: a.lastReply ? `готово · ${a.lastReply.preview}` : 'готово', tone: 'done' }
		case 'idle':
			return {
				text: a.queued > 0 ? `ждёт · ${plural(a.queued, 'сообщение', 'сообщения', 'сообщений')} в очереди` : 'свободен',
				tone: 'muted',
			}
	}
}

/** Счётчик плана «готово / всего» или null, если плана нет. */
export function planCount(a: Pick<AgentView, 'plan'>): { done: number; total: number } | null {
	const entries = a.plan?.entries
	if (!entries || entries.length === 0) return null
	return { done: entries.filter(e => e.status === 'completed').length, total: entries.length }
}

/** От агента давно нет событий — возможно, завис (таймер желтеет). */
export const STALE_MS = 5 * 60_000
export function isStale(a: Pick<AgentView, 'lastActivityAt'>, now: number): boolean {
	return now - Date.parse(a.lastActivityAt) > STALE_MS
}
