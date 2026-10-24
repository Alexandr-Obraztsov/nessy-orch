/**
 * Модели агентов (чистые функции): проверка строки модели, сравнение запрошенной и фактической модели.
 * Псевдонимы tclaude (`opus`, `sonnet`, `haiku`) подтверждены спайком (дизайн AgentPort §3, §6в).
 */
import type { AgentView } from '../../shared/types'
import { AppError } from './errors'

export const MODEL_MAX = 100

/** Модель: псевдоним или id без пробелов (`opus`, `claude-sonnet-4-5`, `zai/glm-4.6`, `opus[1m]`). */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/

/** Псевдоним → префикс полного id (tclaude `--model opus` отдаёт `claude-opus-*`). */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
	opus: 'claude-opus',
	sonnet: 'claude-sonnet',
	haiku: 'claude-haiku',
}

/** Псевдоним → префикс полного id; остальное без изменений; пусто → ''. */
export function normalizeModel(model: string | null): string {
	if (!model) return ''
	const m = model.trim()
	return MODEL_ALIASES[m] ?? m
}

/** Фактическая модель соответствует запрошенной (с учётом псевдонимов: `opus` ≈ `claude-opus-4-5`). Не подтверждена (null) — не соответствует. */
export function modelMatches(requested: string, actual: string | null): boolean {
	if (actual === null || actual === '') return false
	const exp = normalizeModel(requested)
	return actual === exp || actual.startsWith(exp) || normalizeModel(actual).startsWith(exp)
}

/** Необязательная модель из запроса/роли: пусто или null → null; иначе строка по формату, иначе 400. */
export function validateModel(raw: string | null | undefined): string | null {
	const m = (raw ?? '').trim()
	if (!m) return null
	if (m.length > MODEL_MAX || !MODEL_RE.test(m)) throw new AppError(400, 'bad_request', `model «${m.slice(0, 40)}» — псевдоним или id модели без пробелов (до ${MODEL_MAX} символов)`)
	return m
}

/** Поля модели представления агента: model — фактическая, иначе запрошенная; modelRequested — запрошенная, только при расхождении. */
export function resolveModelView(requested: string | null, actual: string | null): Pick<AgentView, 'model' | 'modelRequested' | 'modelConfirmed'> {
	return {
		model: actual ?? requested,
		modelRequested: actual !== null && requested !== null && !modelMatches(requested, actual) ? requested : null,
		modelConfirmed: actual !== null,
	}
}
