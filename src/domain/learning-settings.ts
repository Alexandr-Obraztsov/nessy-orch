import type { LearningSettings } from '../../shared/types'
import { AppError } from './errors'

/** Сколько отказов описания выдерживает один блок: затем задание — провал, свежий агент продолжит с принятого. */
export const MAX_REJECTS = 3
/** Размер порции событий для сборщика, знаков (~50 тыс. токенов). */
export const PORTION_CHARS = 150_000
/** Сколько знаков материалов сборщик плейбука берёт сразу; больше — сначала разбор каждого кейса отдельным агентом. */
export const BUILD_CHARS = 300_000

/** Умолчания и границы настроек (`learning.json`); таймеров и порогов вне настроек у очереди нет. */
export const DEFAULT_LEARNING: LearningSettings = {
	enabled: true,
	autoReview: true,
	intervalMin: 10,
	idleMin: 120,
	maxAgents: 2,
	retrySec: 60,
	stallMin: 20,
	blockEvents: 80,
	blockChars: 40_000,
	archiveDays: 30,
	disabledSessions: [],
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(n)))

const num = (v: unknown, def: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : def)

/** Настройки из файла: битые поля заменяются умолчаниями поштучно, числа ограничиваются. */
export const parseLearningSettings = (raw: unknown): LearningSettings => {
	const o = isObject(raw) ? raw : {}
	const d = DEFAULT_LEARNING
	const sessions = Array.isArray(o['disabledSessions']) ? o['disabledSessions'].filter((s): s is string => typeof s === 'string') : []
	return {
		enabled: typeof o['enabled'] === 'boolean' ? o['enabled'] : d.enabled,
		autoReview: typeof o['autoReview'] === 'boolean' ? o['autoReview'] : d.autoReview,
		intervalMin: num(o['intervalMin'], d.intervalMin, 1, 120),
		idleMin: num(o['idleMin'], d.idleMin, 5, 10_080),
		maxAgents: num(o['maxAgents'], d.maxAgents, 1, 6),
		retrySec: num(o['retrySec'], d.retrySec, 5, 3600),
		stallMin: num(o['stallMin'], d.stallMin, 0, 720),
		blockEvents: num(o['blockEvents'], d.blockEvents, 10, 400),
		blockChars: num(o['blockChars'], d.blockChars, 4000, 200_000),
		archiveDays: num(o['archiveDays'], d.archiveDays, 0, 365),
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
	for (const key of ['intervalMin', 'idleMin', 'maxAgents', 'retrySec', 'stallMin', 'blockEvents', 'blockChars', 'archiveDays'] as const) {
		const v = patch[key]
		if (v === undefined) continue
		if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(key, 'число')
		next[key] = v
	}
	const ds = patch['disabledSessions']
	if (ds !== undefined) {
		if (!Array.isArray(ds) || ds.some(s => typeof s !== 'string')) throw bad('disabledSessions', 'массив строк')
		next['disabledSessions'] = ds
	}
	return parseLearningSettings(next)
}
