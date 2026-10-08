/** Проверка и разбор тел запросов (вход — unknown). */
import type { RoleRequest, SendRequest, SpaceRequest, SpawnRequest } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { isObject } from '../../lib/json'

const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function parseSpaceRequest(b: unknown): SpaceRequest {
	if (!isObject(b) || typeof b['path'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле path (строка)')
	return { path: b['path'], name: optStr(b['name']), url: optStr(b['url']) }
}

export function parseSpawnRequest(b: unknown): SpawnRequest {
	if (!isObject(b)) throw new AppError(400, 'bad_request', 'ожидается JSON-объект')
	return {
		space: optStr(b['space']),
		name: optStr(b['name']),
		role: optStr(b['role']),
		prompt: optStr(b['prompt']),
		parent: optStr(b['parent']),
		from: optStr(b['from']),
		wait: b['wait'] === true,
		waitTimeoutSec: optNum(b['waitTimeoutSec']),
	}
}

export function parseSendRequest(b: unknown): SendRequest {
	if (!isObject(b) || typeof b['text'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле text (строка)')
	return {
		text: b['text'],
		from: optStr(b['from']),
		interrupt: typeof b['interrupt'] === 'boolean' ? b['interrupt'] : undefined,
		wait: b['wait'] === true,
		waitTimeoutSec: optNum(b['waitTimeoutSec']),
	}
}

/** Тело роли: name и instructions — строки (длины и формат проверяет домен). */
export function parseRoleRequest(b: unknown): RoleRequest {
	if (!isObject(b) || typeof b['name'] !== 'string' || typeof b['instructions'] !== 'string')
		throw new AppError(400, 'bad_request', 'нужны поля name и instructions (строки)')
	const color = b['color']
	if (color !== undefined && typeof color !== 'number') throw new AppError(400, 'bad_request', 'color — число 0..360')
	const id = b['id']
	if (id !== undefined && typeof id !== 'string') throw new AppError(400, 'bad_request', 'id — строка')
	const description = b['description']
	if (description !== undefined && typeof description !== 'string') throw new AppError(400, 'bad_request', 'description — строка')
	return { name: b['name'], instructions: b['instructions'], description, color, id }
}

/** Тело плана: entries — массив (записи проверяет домен), from — необязательная строка. */
export function parsePlanRequest(b: unknown): { from?: string; entries: unknown[] } {
	if (!isObject(b) || !Array.isArray(b['entries'])) throw new AppError(400, 'bad_plan', 'нужно поле entries (массив {content, status})')
	const from = b['from']
	if (from !== undefined && typeof from !== 'string') throw new AppError(400, 'bad_request', 'from — строка')
	return { from, entries: b['entries'] }
}

/** Решение по разрешению: всё, кроме явного `approve: false`, — разрешить. */
export function parseApprove(b: unknown): boolean {
	return !(isObject(b) && b['approve'] === false)
}
