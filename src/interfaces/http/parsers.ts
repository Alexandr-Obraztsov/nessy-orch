/** Проверка и разбор тел запросов (вход — unknown). */
import type { AttachRequest, PlaybookParam, PlaybookPatch, PlaybookStage, RoleRequest, RuleInput, SendRequest, SpaceRequest, SpawnRequest, SessionPatch, SessionRequest, SessionStatus } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { skillName } from '../../domain/playbook-render'
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
	const icon = b['icon']
	if (icon !== undefined && typeof icon !== 'string') throw new AppError(400, 'bad_request', 'icon — строка')
	const packageDir = b['packageDir']
	if (packageDir !== undefined && typeof packageDir !== 'string') throw new AppError(400, 'bad_request', 'packageDir — строка')
	return { name: b['name'], instructions: b['instructions'], description, color, icon, id, ...(packageDir ? { packageDir } : {}) }
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

/** Разбор прошлых сессий: `ids` — id кандидатов из `GET /learning/backfill`. */
export function parseBackfillRequest(b: unknown): string[] {
	if (!isObject(b) || !Array.isArray(b['ids']) || b['ids'].some(x => typeof x !== 'string' || x === '')) throw new AppError(400, 'bad_request', 'нужно поле ids (массив непустых строк)')
	return b['ids'] as string[]
}

/** Тело с одной строкой: `{text}` (заметки, чат); пустая строка допустима, если `allowEmpty`. */
export function parseTextBody(b: unknown, allowEmpty = false): string {
	if (!isObject(b) || typeof b['text'] !== 'string' || (!allowEmpty && b['text'].trim() === '')) throw new AppError(400, 'bad_request', 'нужно поле text (строка)')
	return b['text']
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
	if (!isObject(b) || typeof b['version'] !== 'number' || !Number.isInteger(b['version']) || b['version'] < 1) throw new AppError(400, 'bad_request', 'нужно поле version (целое от 1)')
	return b['version']
}

const bad = (what: string): AppError => new AppError(400, 'bad_request', what)

function strList(v: unknown, name: string): string[] {
	if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw bad(`${name} — массив строк`)
	return v as string[]
}

function objList(v: unknown, name: string): Array<Record<string, unknown>> {
	if (!Array.isArray(v) || v.some(x => !isObject(x))) throw bad(`${name} — массив объектов`)
	return v as Array<Record<string, unknown>>
}

const str = (o: Record<string, unknown>, k: string, where: string): string => {
	const v = o[k]
	if (typeof v !== 'string') throw bad(`${where}.${k} — строка`)
	return v
}

function parseStage(o: Record<string, unknown>): PlaybookStage {
	const title = str(o, 'title', 'stages')
	const role = o['role']
	if (role !== null && role !== undefined && typeof role !== 'string') throw bad('stages.role — строка или null')
	if (o['gate'] !== undefined && typeof o['gate'] !== 'boolean') throw bad('stages.gate — boolean')
	const slug = typeof o['slug'] === 'string' && o['slug'] !== '' ? o['slug'] : skillName(title)
	// `n` клиента не берётся: ступени нумеруются по порядку массива
	return { n: 0, slug, title, role: role ?? null, where: str(o, 'where', 'stages'), produce: str(o, 'produce', 'stages'), done: str(o, 'done', 'stages'), gate: o['gate'] === true, template: str(o, 'template', 'stages') }
}

/** Правка плейбука блоками: `PATCH /learning/playbooks/:id`; все поля необязательны, но хотя бы одно нужно. */
export function parsePlaybookPatch(b: unknown): PlaybookPatch {
	if (!isObject(b)) throw bad('ожидается JSON-объект')
	const patch: PlaybookPatch = {}
	if (b['title'] !== undefined) patch.title = str(b, 'title', 'body')
	if (b['description'] !== undefined) patch.description = str(b, 'description', 'body')
	if (b['params'] !== undefined) patch.params = objList(b['params'], 'params').map((o): PlaybookParam => ({ name: str(o, 'name', 'params'), description: str(o, 'description', 'params'), source: str(o, 'source', 'params') }))
	if (b['sources'] !== undefined) patch.sources = strList(b['sources'], 'sources')
	if (b['files'] !== undefined) patch.files = strList(b['files'], 'files')
	if (b['behavior'] !== undefined) patch.behavior = strList(b['behavior'], 'behavior')
	if (b['stages'] !== undefined) patch.stages = objList(b['stages'], 'stages').map(parseStage)
	if (b['rules'] !== undefined) {
		patch.rules = objList(b['rules'], 'rules').map((o): RuleInput => {
			const text = str(o, 'text', 'rules')
			if (text.trim() === '') throw bad('rules.text — непустая строка')
			const stage = o['stage']
			if (stage !== null && (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1)) throw bad('rules.stage — целое от 1 или null')
			const id = o['id']
			if (id !== undefined && (typeof id !== 'string' || id === '')) throw bad('rules.id — непустая строка')
			return id === undefined ? { text, stage } : { id, text, stage }
		})
	}
	if (!Object.keys(patch).length) throw bad('нужно хотя бы одно поле: title, description, params, sources, files, behavior, stages, rules')
	return patch
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
