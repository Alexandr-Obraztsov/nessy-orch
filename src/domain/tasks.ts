/**
 * Задачи оркестраторов (чистые функции): slug id из заголовка (с транслитерацией кириллицы),
 * проверка заголовка, id, владельца и правки задачи.
 */
import type { TaskPatch, TaskRequest, TaskStatus } from '../../shared/types'
import { AppError } from './errors'
import { transliterate } from './roles'
import type { TaskFields } from './types'

export const TASK_TITLE_MAX = 200
export const TASK_OWNER_MAX = 60
export const TASK_SUMMARY_MAX = 20000
export const TASK_ID_MAX = 48
/** длина основы slug из заголовка (без суффикса) */
const TASK_SLUG_BASE_MAX = 40

const TASK_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const STATUSES: readonly TaskStatus[] = ['active', 'done']

const bad = (msg: string): AppError => new AppError(400, 'bad_request', msg)

/** Основа slug из заголовка: латиница, цифры и дефис; пусто — 'task'. */
export function taskSlugBase(title: string): string {
	const slug = transliterate(title)
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, TASK_SLUG_BASE_MAX)
		.replace(/-+$/, '')
	return slug || 'task'
}

/** id задачи из заголовка и суффикса: `fix-ci-3f2a`. */
export function taskIdFrom(title: string, suffix: string): string {
	return `${taskSlugBase(title)}-${suffix}`
}

export function isTaskId(id: string): boolean {
	return id.length <= TASK_ID_MAX && TASK_ID_RE.test(id)
}

export function isTaskStatus(v: unknown): v is TaskStatus {
	return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

function checkTitle(raw: string): string {
	const title = raw.replace(/\s+/g, ' ').trim()
	if (!title) throw bad('title обязателен')
	if (title.length > TASK_TITLE_MAX) throw bad(`title длиннее ${TASK_TITLE_MAX} символов`)
	return title
}

/** Проверить запрос на создание задачи. `id` — null, если его надо сгенерировать из заголовка. */
export function validateTaskRequest(req: TaskRequest): TaskFields {
	const title = checkTitle(req.title)
	const owner = req.owner?.trim() || null
	if (owner && owner.length > TASK_OWNER_MAX) throw bad(`owner длиннее ${TASK_OWNER_MAX} символов`)
	const id = req.id === undefined ? null : req.id.trim()
	if (id !== null && !isTaskId(id)) throw bad(`id «${id}» должен состоять из [a-z0-9-] (до ${TASK_ID_MAX} символов)`)
	return { id, title, owner }
}

/** Проверить правку задачи: только известные поля, пустой summary → null. */
export function validateTaskPatch(p: TaskPatch): TaskPatch {
	const out: TaskPatch = {}
	if (p.title !== undefined) out.title = checkTitle(p.title)
	if (p.status !== undefined) {
		if (!isTaskStatus(p.status)) throw bad(`status — одно из: ${STATUSES.join(', ')}`)
		out.status = p.status
	}
	if (p.summary !== undefined) {
		const s = p.summary === null ? '' : p.summary.trim()
		if (s.length > TASK_SUMMARY_MAX) throw bad(`summary длиннее ${TASK_SUMMARY_MAX} символов`)
		out.summary = s || null
	}
	return out
}
