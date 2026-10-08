/**
 * Безопасная работа с внешним JSON: всё приходит как `unknown`,
 * наружу выходят только проверенные типы. Заменяет `any` и касты.
 */
import type { JsonObject } from './json.types'

export function isObject(v: unknown): v is JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function obj(v: unknown): JsonObject {
	return isObject(v) ? v : {}
}

export function arr(v: unknown): unknown[] {
	return Array.isArray(v) ? v : []
}

export function str(v: unknown, def = ''): string {
	return typeof v === 'string' ? v : def
}

export function strOrNull(v: unknown): string | null {
	return typeof v === 'string' && v !== '' ? v : null
}

export function num(v: unknown, def = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : def
}

export function bool(v: unknown, def = false): boolean {
	return typeof v === 'boolean' ? v : def
}

/** Разобрать JSON-строку в unknown (без исключений). */
export function parseJson(s: string): unknown {
	try {
		return JSON.parse(s) as unknown
	} catch {
		return undefined
	}
}

export function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}
