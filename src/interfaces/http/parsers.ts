/** Проверка и разбор тел запросов (вход — unknown). */
import type { RoleRequest, SendRequest, SpaceRequest, SpawnRequest, SessionPatch, SessionRequest, SessionStatus } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { isSessionStatus } from '../../domain/sessions'
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
		session: optStr(b['session']),
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

/** Тело новой сессии: title — строка, owner и id — необязательные строки (формат проверяет домен). */
export function parseSessionRequest(b: unknown): SessionRequest {
	if (!isObject(b) || typeof b['title'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле title (строка)')
	const owner = b['owner']
	if (owner !== undefined && owner !== null && typeof owner !== 'string') throw new AppError(400, 'bad_request', 'owner — строка')
	const id = b['id']
	if (id !== undefined && typeof id !== 'string') throw new AppError(400, 'bad_request', 'id — строка')
	return { title: b['title'], owner: typeof owner === 'string' ? owner : undefined, id }
}

/** Правка сессии: title — строка, status — active|done, summary — строка или null. */
export function parseSessionPatch(b: unknown): SessionPatch {
	if (!isObject(b)) throw new AppError(400, 'bad_request', 'ожидается JSON-объект')
	const out: SessionPatch = {}
	const { title, status, summary } = b
	if (title !== undefined) {
		if (typeof title !== 'string') throw new AppError(400, 'bad_request', 'title — строка')
		out.title = title
	}
	if (status !== undefined) out.status = parseSessionStatus(status)
	if (summary !== undefined) {
		if (summary !== null && typeof summary !== 'string') throw new AppError(400, 'bad_request', 'summary — строка или null')
		out.summary = summary
	}
	return out
}

/** Статус сессии из запроса (тело или query): active | done. */
export function parseSessionStatus(v: unknown): SessionStatus {
	if (!isSessionStatus(v)) throw new AppError(400, 'bad_request', 'status — active или done')
	return v
}
