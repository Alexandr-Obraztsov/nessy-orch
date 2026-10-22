import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LearningSettings } from '../../../shared/types'
import { decide } from '../../../src/domain/learning-schedule'
import type { ScheduleInput } from '../../../src/domain/learning-schedule'
import { DEFAULT_LEARNING } from '../../../src/domain/learning-settings'

const MIN = 60_000
const s: LearningSettings = { ...DEFAULT_LEARNING, intervalMin: 10, idleMin: 30 }
const NOW = 10_000 * MIN
const base: ScheduleInput = { status: 'collecting', pending: 0, lastRunAt: 0, lastEventAt: NOW, busy: false, hasJob: false }

describe('decide', () => {
	const rows: Array<[string, Partial<ScheduleInput>, 'none' | 'collect' | 'close']> = [
		['задание уже есть', { hasJob: true, pending: 20 }, 'none'],
		['закрытый кейс без новых событий', { status: 'ready', pending: 0 }, 'none'],
		['закрытый кейс с новыми событиями — снова собирать', { status: 'ready', pending: 2 }, 'collect'],
		['закрытый кейс: пауза от lastRunAt тоже соблюдается', { status: 'ready', pending: 2, lastRunAt: NOW - 10_000 }, 'none'],
		['кейс в error сам ничего не запускает', { status: 'error', pending: 20, lastEventAt: NOW - 40 * MIN }, 'none'],
		['простой дольше idleMin закрывает', { lastEventAt: NOW - 30 * MIN, pending: 3 }, 'close'],
		['занятая сессия не закрывается', { lastEventAt: NOW - 40 * MIN, busy: true }, 'none'],
		['пауза 20 с блокирует сбор', { pending: 20, lastRunAt: NOW - 10_000 }, 'none'],
		['одно событие и пауза прошла — сбор', { pending: 1, lastRunAt: NOW - 20_000 }, 'collect'],
		['много событий: порога нет, только пауза', { pending: 15, lastRunAt: NOW - 10_000 }, 'none'],
		['новый кейс (lastRunAt 0) с событием — сразу', { pending: 1, lastRunAt: 0 }, 'collect'],
		['интервал intervalMin не нужен: событий нет — нечего собирать', { pending: 0, lastRunAt: NOW - 20 * MIN }, 'none'],
	]
	for (const [name, patch, want] of rows) {
		it(name, () => assert.equal(decide({ ...base, ...patch }, NOW, s), want))
	}
})
