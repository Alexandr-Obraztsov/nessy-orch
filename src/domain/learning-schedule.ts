import type { CaseStatus, LearningSettings } from '../../shared/types'
import { COOLDOWN_MS } from './learning-settings'

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

/** Что делать с кейсом сейчас: ничего, дописать описание (`collect`) или закрыть (`close`). `intervalMin` в настройках остался для совместимости файла и типов, расписание его не читает. */
export function decide(c: ScheduleInput, now: number, s: LearningSettings): 'none' | 'collect' | 'close' {
	if (c.hasJob) return 'none'
	// закрытый кейс получил новые события: сессия вернулась (с той же паузой между запусками)
	if (c.status === 'ready') return c.pending > 0 && now - c.lastRunAt >= COOLDOWN_MS ? 'collect' : 'none'
	// `error` сам ничего не запускает: только ручные retry/run/rebuild
	if (c.status !== 'collecting') return 'none'
	if (now - c.lastEventAt >= s.idleMin * 60_000 && !c.busy) return 'close'
	// есть необработанное событие и с прошлого запуска прошла пауза — сбор (порога событий и интервала нет)
	return c.pending > 0 && now - c.lastRunAt >= COOLDOWN_MS ? 'collect' : 'none'
}
