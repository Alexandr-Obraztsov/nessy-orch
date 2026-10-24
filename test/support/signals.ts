import type { LearningService } from '../../src/application/learning/learning.service'

/** Хук активности (`Stop`/`UserPromptSubmit`) для сессий: заводит кейсы цепочек, события не читаются. */
export const observe = (svc: LearningService, ...sessions: string[]): void => {
	for (const session of sessions) svc.signal({ event: 'activity', session })
}

/** Хук `SessionEnd` для сессий: события в `raw/`, задание `close` в очереди. */
export const finish = (svc: LearningService, ...sessions: string[]): void => {
	for (const session of sessions) svc.signal({ event: 'end', session })
}
