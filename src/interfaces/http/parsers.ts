/** Проверка и разбор тел запросов (вход — unknown). */
import type {
	AttachRequest,
	LearningSignal,
	ModelRequest,
	RoleRequest,
	RuntimeId,
	SendRequest,
	SpaceRequest,
	SpawnRequest,
	SessionPatch,
	SessionRequest,
	SessionStatus,
} from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { isRuntimeId } from '../../domain/constants'
import { isSessionStatus } from '../../domain/sessions'
import { isObject } from '../../lib/json'

const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** необязательный рантайм: строка и известный рантайм, иначе 400. */
function optRuntime(v: unknown): RuntimeId | undefined {
	if (v === undefined) return undefined
	if (typeof v !== 'string' || !isRuntimeId(v)) throw new AppError(400, 'bad_request', `runtime — одно из: nessy-sdk, tclaude`)
	return v
}

export function parseSpaceRequest(b: unknown): SpaceRequest {
	if (!isObject(b) || typeof b['path'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле path (строка)')
	const model = optStr(b['model'])
	const out = {
		path: b['path'],
		name: optStr(b['name']),
		url: optStr(b['url']),
		...(b['runtime'] !== undefined ? { runtime: optRuntime(b['runtime']) } : {}),
		...(model !== undefined ? { model } : {}),
	}
	return out as SpaceRequest
}

export function parseSpawnRequest(b: unknown): SpawnRequest {
	if (!isObject(b)) throw new AppError(400, 'bad_request', 'ожидается JSON-объект')
	const model = optStr(b['model'])
	const out = {
		space: optStr(b['space']),
		cwd: optStr(b['cwd']),
		name: optStr(b['name']),
		title: optStr(b['title']),
		role: optStr(b['role']),
		session: optStr(b['session']),
		prompt: optStr(b['prompt']),
		parent: optStr(b['parent']),
		from: optStr(b['from']),
		wait: b['wait'] === true,
		waitTimeoutSec: optNum(b['waitTimeoutSec']),
		...(b['runtime'] !== undefined ? { runtime: optRuntime(b['runtime']) } : {}),
		...(model !== undefined ? { model } : {}),
	}
	return out as SpawnRequest
}

export function parseSendRequest(b: unknown): SendRequest {
	if (!isObject(b) || typeof b['text'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле text (строка)')
	const out = {
		text: b['text'],
		from: optStr(b['from']),
		interrupt: typeof b['interrupt'] === 'boolean' ? b['interrupt'] : undefined,
		wait: b['wait'] === true,
		waitTimeoutSec: optNum(b['waitTimeoutSec']),
	}
	return out as SendRequest
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
	const icon = b['icon']
	if (icon !== undefined && typeof icon !== 'string') throw new AppError(400, 'bad_request', 'icon — строка')
	const packageDir = b['packageDir']
	if (packageDir !== undefined && typeof packageDir !== 'string') throw new AppError(400, 'bad_request', 'packageDir — строка')
	const model = b['model']
	if (model !== undefined && model !== null && typeof model !== 'string') throw new AppError(400, 'bad_request', 'model — строка или null')
	const rawRuntime = b['runtime']
	// пустая строка и null убирают рантайм роли; остальное — известный рантайм
	const runtime = rawRuntime === '' || rawRuntime === null ? null : optRuntime(rawRuntime)
	const out = {
		name: b['name'],
		instructions: b['instructions'],
		description,
		color,
		icon,
		id,
		...(model !== undefined ? { model } : {}),
		...(runtime !== undefined ? { runtime } : {}),
		...(packageDir ? { packageDir } : {}),
	}
	return out as RoleRequest
}

/** Тело плана: entries — массив (записи проверяет домен), from — необязательная строка. */
export function parsePlanRequest(b: unknown): { from?: string; entries: unknown[] } {
	if (!isObject(b) || !Array.isArray(b['entries'])) throw new AppError(400, 'bad_plan', 'нужно поле entries (массив {content, status})')
	const from = b['from']
	if (from !== undefined && typeof from !== 'string') throw new AppError(400, 'bad_request', 'from — строка')
	const out = { from, entries: b['entries'] }
	return out as { from?: string; entries: unknown[] }
}

/** Смена модели агента: model — непустая строка (формат проверяет домен). */
export function parseModelRequest(b: unknown): ModelRequest {
	if (!isObject(b) || typeof b['model'] !== 'string' || !b['model'].trim()) throw new AppError(400, 'bad_request', 'нужно поле model (непустая строка)')
	return { model: b['model'].trim() }
}

/** Решение по разрешению: всё, кроме явного `approve: false`, — разрешить. */
export function parseApprove(b: unknown): boolean {
	return !(isObject(b) && b['approve'] === false)
}

/** Тело новой сессии: title — строка, owner и id — необязательные строки (формат проверяет домен). */
export function parseSessionRequest(b: unknown): SessionRequest {
	if (!isObject(b)) throw new AppError(400, 'bad_request', 'ожидается JSON-объект')
	const { title, cwd, chatId } = b
	if (title !== undefined && typeof title !== 'string') throw new AppError(400, 'bad_request', 'title — строка')
	if (cwd !== undefined && typeof cwd !== 'string') throw new AppError(400, 'bad_request', 'cwd — строка')
	if (chatId !== undefined && typeof chatId !== 'string') throw new AppError(400, 'bad_request', 'chatId — строка')
	if (title === undefined && cwd === undefined) throw new AppError(400, 'bad_request', 'нужно поле title или cwd')
	const owner = b['owner']
	if (owner !== undefined && owner !== null && typeof owner !== 'string') throw new AppError(400, 'bad_request', 'owner — строка')
	const id = b['id']
	if (id !== undefined && typeof id !== 'string') throw new AppError(400, 'bad_request', 'id — строка')
	return {
		...(title !== undefined ? { title } : {}),
		...(typeof owner === 'string' ? { owner } : {}),
		...(id !== undefined ? { id } : {}),
		...(cwd !== undefined ? { cwd } : {}),
		...(chatId !== undefined ? { chatId } : {}),
	}
}

/** Привязка чата Claude к сессии: chatId обязателен, cwd и from — необязательные строки. */
export function parseAttachRequest(b: unknown): AttachRequest {
	if (!isObject(b) || typeof b['chatId'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле chatId (строка)')
	const { cwd, from, transcriptPath } = b
	if (cwd !== undefined && typeof cwd !== 'string') throw new AppError(400, 'bad_request', 'cwd — строка')
	if (from !== undefined && typeof from !== 'string') throw new AppError(400, 'bad_request', 'from — строка')
	if (transcriptPath !== undefined && typeof transcriptPath !== 'string') throw new AppError(400, 'bad_request', 'transcriptPath — строка')
	return { chatId: b['chatId'], ...(cwd ? { cwd } : {}), ...(from ? { from } : {}), ...(transcriptPath ? { transcriptPath } : {}) }
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

/** Запуск сбора: `session` — id сессии или кейса (нет — все открытые кейсы). */
export function parseLearningRun(b: unknown): { session?: string } {
	if (!isObject(b)) throw new AppError(400, 'bad_request', 'ожидается JSON-объект')
	const s = b['session']
	if (s !== undefined && (typeof s !== 'string' || s === '')) throw new AppError(400, 'bad_request', 'session — непустая строка')
	return s === undefined ? {} : { session: s }
}

/** Тело `POST /learning/signal`: `{event: 'activity' | 'end', session, chatId?, transcriptPath?}`. */
export function parseLearningSignal(b: unknown): LearningSignal {
	if (!isObject(b)) throw new AppError(400, 'bad_request', 'ожидается JSON-объект')
	const event = b['event']
	if (event !== 'activity' && event !== 'end') throw new AppError(400, 'bad_request', 'event — activity или end')
	const session = b['session']
	if (typeof session !== 'string' || session === '') throw new AppError(400, 'bad_request', 'session — непустая строка')
	const opt = (k: string): string | undefined => {
		const v = b[k]
		if (v === undefined) return undefined
		if (typeof v !== 'string') throw new AppError(400, 'bad_request', `${k} — строка`)
		return v === '' ? undefined : v
	}
	const chatId = opt('chatId')
	const transcriptPath = opt('transcriptPath')
	return { event, session, ...(chatId ? { chatId } : {}), ...(transcriptPath ? { transcriptPath } : {}) }
}

/** Тело с одной строкой: `{text}` (заметки, чат); пустая строка допустима, если `allowEmpty`. */
export function parseTextBody(b: unknown, allowEmpty = false): string {
	if (!isObject(b) || typeof b['text'] !== 'string' || (!allowEmpty && b['text'].trim() === ''))
		throw new AppError(400, 'bad_request', 'нужно поле text (строка)')
	return b['text']
}

/** Тело `PUT /learning/cases/:id/summary`: `{text, base}`, `base` — sha1 (hex) описания, против которого правили. */
export function parseSummaryPut(b: unknown): { text: string; base: string } {
	if (!isObject(b) || typeof b['text'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле text (строка)')
	const base = b['base']
	if (typeof base !== 'string' || !/^[0-9a-f]{40}$/.test(base)) throw new AppError(400, 'bad_request', 'нужно поле base (sha1 hex описания)')
	return { text: b['text'], base }
}

/** Причина отказа: `{reason}`, необязательная. */
export function parseReason(b: unknown): string {
	if (!isObject(b)) return ''
	return typeof b['reason'] === 'string' ? b['reason'] : ''
}

/** Статус плейбука вручную: `{status}`. */
export function parsePlaybookStatus(b: unknown): string {
	if (!isObject(b) || typeof b['status'] !== 'string') throw new AppError(400, 'bad_request', 'нужно поле status (строка)')
	return b['status']
}

/** Номер версии для отката: `{version}` — целое от 1. */
export function parseVersion(b: unknown): number {
	if (!isObject(b) || typeof b['version'] !== 'number' || !Number.isInteger(b['version']) || b['version'] < 1)
		throw new AppError(400, 'bad_request', 'нужно поле version (целое от 1)')
	return b['version']
}

const bad = (what: string): AppError => new AppError(400, 'bad_request', what)

/** Тело `PUT /learning/playbooks/:id/markdown`: `{text, baseVersion}`; `baseVersion` — целое от 1 (версия, на которой правили). */
export function parsePlaybookMarkdown(b: unknown): { text: string; baseVersion: number } {
	if (!isObject(b) || typeof b['text'] !== 'string') throw bad('нужно поле text (строка)')
	const baseVersion = b['baseVersion']
	if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) throw bad('baseVersion — целое от 1 (версия, на которой правили)')
	return { text: b['text'], baseVersion }
}

/** Границы событий кейса: `from` (по умолчанию 0) и необязательный `to`; целые от 0, `from <= to`. */
export function parseRawRange(from: string | null, to: string | null): { from: number; to?: number } {
	const num = (v: string, name: string): number => {
		const n = Number(v)
		if (v.trim() === '' || !Number.isInteger(n) || n < 0) throw bad(`${name} — целое от 0`)
		return n
	}
	const a = from === null ? 0 : num(from, 'from')
	if (to === null) return { from: a }
	const z = num(to, 'to')
	if (z < a) throw bad('to не меньше from')
	return { from: a, to: z }
}
