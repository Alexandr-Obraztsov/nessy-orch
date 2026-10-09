/**
 * Отображаемое состояние агента: одна иконка, одна подпись, одна группа таблицы.
 * Порядок важности: ждёт разрешения → ошибка → работает → запуск → выполнено → свободен.
 */
import type { AgentView, ToolBrief } from '@contract'
import type { AgentGroup, AgentState, PlanProgress, StateCounts, ToolLabel } from './state.types'

type StateInput = Pick<AgentView, 'status' | 'archived' | 'pendingPermissions' | 'lastReply'>

export function agentState(a: StateInput): AgentState {
	if (a.pendingPermissions.length > 0) return 'wait'
	if (a.status === 'error') return 'error'
	if (a.status === 'working') return 'working'
	if (a.status === 'starting') return 'starting'
	// свободен: ответил вам или ушёл в архив — задача выполнена, иначе ждёт поручения
	return a.archived || (a.lastReply !== null && !a.lastReply.failed) ? 'done' : 'idle'
}

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
	wait: 'Ждёт разрешения',
	error: 'Ошибка',
	working: 'Работает',
	starting: 'Запускается',
	idle: 'Ждёт поручения',
	done: 'Выполнено',
}

/** «Выполнено» — только закончившие задачу; остальные, включая ошибки, — в «Работают». */
export const groupOf = (s: AgentState): AgentGroup => (s === 'done' ? 'done' : 'work')

/** Требует вашего внимания: запрос разрешения или ошибка (они же — число в заголовке вкладки). */
export const needsAttention = (s: AgentState): boolean => s === 'wait' || s === 'error'

/** Ход идёт — его можно остановить. */
export const canStop = (a: Pick<AgentView, 'status'>): boolean => a.status === 'working' || a.status === 'starting'

/** План агента: x из y, текущий шаг. null — плана нет. */
export function planProgress(a: Pick<AgentView, 'plan'>): PlanProgress | null {
	const entries = a.plan?.entries
	if (!entries || entries.length === 0) return null
	const active = entries.findIndex(e => e.status === 'in_progress')
	return {
		done: entries.filter(e => e.status === 'completed').length,
		total: entries.length,
		active,
		step: active === -1 ? null : (entries[active]?.content ?? null),
	}
}

/** Разбор заголовка инструмента: «Shell: npm test» → { name: 'Shell', arg: 'npm test' }. */
export function toolLabel(t: ToolBrief | { name: string; title: string }): ToolLabel {
	const title = t.title.trim()
	const i = title.indexOf(': ')
	if (i > 0 && i <= 24) return { name: title.slice(0, i), arg: title.slice(i + 2) }
	return { name: t.name || title, arg: t.name && title !== t.name ? title : '' }
}

const time = (iso: string | null): number | null => {
	if (!iso) return null
	const t = Date.parse(iso)
	return Number.isNaN(t) ? null : t
}

/**
 * Время в колонке «Время», мс: у идущего хода — от его начала до «сейчас»,
 * у закончившего — длительность последнего хода; null — показать «—».
 */
export function elapsedMs(a: AgentView, now: number): number | null {
	const started = time(a.turnStartedAt)
	if (started !== null && (a.status === 'working' || a.status === 'starting')) return Math.max(0, now - started)
	if (a.status === 'starting') return Math.max(0, now - (time(a.createdAt) ?? now))
	return a.lastTurnMs
}

/** Краткий итог из превью ответа: без служебного «Итог:» в начале. */
export function resultSummary(a: Pick<AgentView, 'lastReply'>): string {
	const p = a.lastReply?.preview.trim() ?? ''
	return p.replace(/^(?:итог|ответ|резюме|вердикт)\s*[:—–-]\s*/i, '')
}

/** Момент, по которому сортируются выполненные (новые сверху). */
export const finishedAt = (a: AgentView): number => a.lastReply?.ts ?? time(a.lastActivityAt) ?? 0

/** Счётчики по состояниям (без фильтров). */
export function countStates(agents: AgentView[]): StateCounts {
	const c: StateCounts = { all: agents.length, wait: 0, working: 0, error: 0, done: 0 }
	for (const a of agents) {
		const st = agentState(a)
		if (st === 'wait' || st === 'error' || st === 'done') c[st]++
		else c.working++
	}
	return c
}
