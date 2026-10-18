import type { LearningSettings } from '../../shared/types'
import { AppError } from './errors'

/** Раз в сколько новых событий сборщик запускается, не дожидаясь интервала. */
export const EVENTS_TRIGGER = 15
/** Пауза между запусками сборщика одного кейса, мс. */
export const COOLDOWN_MS = 60_000
/** Размер порции событий для сборщика, знаков (~50 тыс. токенов). */
export const PORTION_CHARS = 150_000

export const DEFAULT_LEARNING: LearningSettings = {
	enabled: true,
	autoReview: true,
	intervalMin: 10,
	idleMin: 30,
	maxAgents: 2,
	disabledSessions: [],
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(n)))

const num = (v: unknown, def: number, min: number, max: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : def

/** Настройки из файла: битые поля заменяются умолчаниями поштучно, числа ограничиваются. */
export const parseLearningSettings = (raw: unknown): LearningSettings => {
	const o = isObject(raw) ? raw : {}
	const d = DEFAULT_LEARNING
	const sessions = Array.isArray(o['disabledSessions']) ? o['disabledSessions'].filter((s): s is string => typeof s === 'string') : []
	return {
		enabled: typeof o['enabled'] === 'boolean' ? o['enabled'] : d.enabled,
		autoReview: typeof o['autoReview'] === 'boolean' ? o['autoReview'] : d.autoReview,
		intervalMin: num(o['intervalMin'], d.intervalMin, 1, 120),
		idleMin: num(o['idleMin'], d.idleMin, 5, 1440),
		maxAgents: num(o['maxAgents'], d.maxAgents, 1, 6),
		disabledSessions: [...new Set(sessions)],
	}
}

const bad = (field: string, want: string): AppError => new AppError(400, 'bad_request', `${field}: ожидается ${want}`)

/** Применяет частичную правку из API; неверный тип поля — 400 `bad_request`. */
export const patchLearningSettings = (prev: LearningSettings, patch: unknown): LearningSettings => {
	if (!isObject(patch)) throw bad('тело', 'объект')
	const next: Record<string, unknown> = { ...prev }
	for (const key of ['enabled', 'autoReview'] as const) {
		const v = patch[key]
		if (v === undefined) continue
		if (typeof v !== 'boolean') throw bad(key, 'boolean')
		next[key] = v
	}
	for (const key of ['intervalMin', 'idleMin', 'maxAgents'] as const) {
		const v = patch[key]
		if (v === undefined) continue
		if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(key, 'число')
		next[key] = v
	}
	const ds = patch['disabledSessions']
	if (ds !== undefined) {
		if (!Array.isArray(ds) || ds.some((s) => typeof s !== 'string')) throw bad('disabledSessions', 'массив строк')
		next['disabledSessions'] = ds
	}
	return parseLearningSettings(next)
}
