/**
 * Отображаемое состояние агента: одна иконка, одна подпись, одно место в порядке карточек.
 * Порядок важности: ждёт разрешения → ошибка → работает → запуск → выполнено → свободен.
 */
import type { AgentView } from '@contract'
import type { AgentState, PlanProgress } from './state.types'

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

const time = (iso: string | null): number | null => {
	if (!iso) return null
	const t = Date.parse(iso)
	return Number.isNaN(t) ? null : t
}

/**
 * Таймер хода на карточке, мс: у идущего хода — от его начала до «сейчас»,
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

/**
 * Порядок карточек в задаче: ждут разрешения → работают → ошибка → ждут поручения → выполненные.
 * Внутри ранга — в порядке запуска (карточки не прыгают при каждом событии).
 */
const RANK: Record<AgentState, number> = { wait: 0, working: 1, starting: 1, error: 2, idle: 3, done: 4 }

export function sortCards(agents: AgentView[]): AgentView[] {
	return agents
		.map(a => ({ a, r: RANK[agentState(a)], t: time(a.createdAt) ?? 0 }))
		.sort((x, y) => x.r - y.r || x.t - y.t || x.a.id.localeCompare(y.a.id))
		.map(x => x.a)
}

/** Агент ждёт решения человека. */
export const isWaiting = (a: Pick<AgentView, 'pendingPermissions'>): boolean => a.pendingPermissions.length > 0

/** Агент сейчас работает (ход идёт). */
export const isLive = (a: Pick<AgentView, 'status'>): boolean => a.status === 'working' || a.status === 'starting'
