import type { CaseStatus, LearningSettings } from '../../shared/types'
import { COOLDOWN_MS, EVENTS_TRIGGER } from './learning-settings'

export interface ScheduleInput {
	status: CaseStatus
	/** событий, ещё не учтённых в описании */
	pending: number
	lastRunAt: number
	lastEventAt: number
	/** в сессиях кейса работает агент или есть очередь */
	busy: boolean
	/** по кейсу уже есть задание в очереди или в работе */
	hasJob: boolean
}

/** Что делать с кейсом сейчас: ничего, дописать описание (`collect`) или закрыть (`close`). */
export function decide(c: ScheduleInput, now: number, s: LearningSettings): 'none' | 'collect' | 'close' {
	if (c.hasJob) return 'none'
	// закрытый кейс получил новые события: сессия вернулась
	if (c.status === 'ready') return c.pending > 0 ? 'collect' : 'none'
	if (c.status !== 'collecting') return 'none'
	if (now - c.lastEventAt >= s.idleMin * 60_000 && !c.busy) return 'close'
	if (now - c.lastRunAt < COOLDOWN_MS) return 'none'
	if (c.pending >= EVENTS_TRIGGER) return 'collect'
	if (c.pending > 0 && now - c.lastRunAt >= s.intervalMin * 60_000) return 'collect'
	return 'none'
}
