/**
 * Сессии оркестраторов (чистые функции): slug id из заголовка (с транслитерацией кириллицы),
 * проверка заголовка, id, владельца и правки сессии.
 */
import type { SessionPatch, SessionRequest, SessionStatus } from '../../shared/types'
import { AppError } from './errors'
import { transliterate } from './roles'
import type { SessionFields } from './types'

export const SESSION_TITLE_MAX = 200
export const SESSION_OWNER_MAX = 60
export const SESSION_SUMMARY_MAX = 20000
export const SESSION_ID_MAX = 48
/** длина основы slug из заголовка (без суффикса) */
const SESSION_SLUG_BASE_MAX = 40

const SESSION_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const STATUSES: readonly SessionStatus[] = ['active', 'done']

const bad = (msg: string): AppError => new AppError(400, 'bad_request', msg)

/** Основа slug из заголовка: латиница, цифры и дефис; пусто — 'session'. */
export function sessionSlugBase(title: string): string {
	const slug = transliterate(title)
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SESSION_SLUG_BASE_MAX)
		.replace(/-+$/, '')
	return slug || 'session'
}

/** id сессии из заголовка и суффикса: `fix-ci-3f2a`. */
export function sessionIdFrom(title: string, suffix: string): string {
	return `${sessionSlugBase(title)}-${suffix}`
}

export function isSessionId(id: string): boolean {
	return id.length <= SESSION_ID_MAX && SESSION_ID_RE.test(id)
}

export function isSessionStatus(v: unknown): v is SessionStatus {
	return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

function checkTitle(raw: string): string {
	const title = raw.replace(/\s+/g, ' ').trim()
	if (!title) throw bad('title обязателен')
	if (title.length > SESSION_TITLE_MAX) throw bad(`title длиннее ${SESSION_TITLE_MAX} символов`)
	return title
}

/** Проверить запрос на создание сессии. `id` — null, если его надо сгенерировать из заголовка. */
export function validateSessionRequest(req: SessionRequest): SessionFields {
	const title = checkTitle(req.title)
	const owner = req.owner?.trim() || null
	if (owner && owner.length > SESSION_OWNER_MAX) throw bad(`owner длиннее ${SESSION_OWNER_MAX} символов`)
	const id = req.id === undefined ? null : req.id.trim()
	if (id !== null && !isSessionId(id)) throw bad(`id «${id}» должен состоять из [a-z0-9-] (до ${SESSION_ID_MAX} символов)`)
	return { id, title, owner }
}

/** Проверить правку сессии: только известные поля, пустой summary → null. */
export function validateSessionPatch(p: SessionPatch): SessionPatch {
	const out: SessionPatch = {}
	if (p.title !== undefined) out.title = checkTitle(p.title)
	if (p.status !== undefined) {
		if (!isSessionStatus(p.status)) throw bad(`status — одно из: ${STATUSES.join(', ')}`)
		out.status = p.status
	}
	if (p.summary !== undefined) {
		const s = p.summary === null ? '' : p.summary.trim()
		if (s.length > SESSION_SUMMARY_MAX) throw bad(`summary длиннее ${SESSION_SUMMARY_MAX} символов`)
		out.summary = s || null
	}
	return out
}
