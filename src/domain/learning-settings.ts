import type { LearningSettings } from '../../shared/types'
import { AppError } from './errors'

/** Пауза между запусками сборщика одного кейса, мс: есть необработанное событие и пауза прошла — сбор ставится. */
export const COOLDOWN_MS = 20_000
/** Окно сведения событий шины в один `tick`, мс (новое сообщение или сессия → `tick` через это время). */
export const TICK_DEBOUNCE_MS = 2_000
/** Задание без активности (старт, `read`, `draft`, новый вызов агента) столько мс снимается: агент отменяется, задание — провал. */
export const JOB_STALL_MS = 600_000
/** Пауза повтора после провала: `min(RETRY_BASE_MS × 2^(попытка−1), RETRY_MAX_MS)`. */
export const RETRY_BASE_MS = 5_000
export const RETRY_MAX_MS = 120_000
/** Блок чтения сборщика: не больше событий и знаков (одно событие берётся всегда); дальше — только после принятого описания. */
export const BLOCK_EVENTS = 25
export const BLOCK_CHARS = 12_000
/** Сколько отказов описания выдерживает один блок: затем задание — провал, свежий агент продолжит с принятого. */
export const MAX_REJECTS = 3
/** Размер порции событий для сборщика, знаков (~50 тыс. токенов). */
export const PORTION_CHARS = 150_000
/** Сколько знаков материалов сборщик плейбука берёт сразу; больше — сначала разбор каждого кейса отдельным агентом. */
export const BUILD_CHARS = 300_000

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
