/**
 * Роли субагентов (чистые функции): проверка полей, slug из имени (с транслитерацией кириллицы),
 * цвет метки из хеша имени.
 */
import { AppError } from './errors'
import type { RoleFields, RoleInput } from './types'

export const ROLE_NAME_MAX = 60
export const ROLE_INSTRUCTIONS_MAX = 20000
export const ROLE_DESCRIPTION_MAX = 300
export const ROLE_ID_MAX = 40

const ROLE_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const TRANSLIT: Readonly<Record<string, string>> = {
	а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
	н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
	ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}

/** Кириллица → латиница (остальные символы без изменений), в нижнем регистре. */
export function transliterate(s: string): string {
	let out = ''
	for (const ch of s.toLowerCase()) out += TRANSLIT[ch] ?? ch
	return out
}

/** slug роли из имени: латиница, цифры и дефис, не длиннее 40 символов. */
export function roleSlug(name: string): string {
	const slug = transliterate(name)
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, ROLE_ID_MAX)
		.replace(/-+$/, '')
	return slug || 'role'
}

export function isRoleId(id: string): boolean {
	return id.length <= ROLE_ID_MAX && ROLE_ID_RE.test(id)
}

/** Цвет метки (hue 0..359) — стабильный хеш имени. */
export function roleColor(name: string): number {
	let h = 0
	for (const ch of name.toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
	return h % 360
}

const bad = (msg: string): AppError => new AppError(400, 'bad_request', msg)

/**
 * Проверить поля роли. `id` берётся из запроса или из имени (уникальность проверяет сервис);
 * `color` — из запроса или из хеша имени.
 */
export function validateRole(input: RoleInput): RoleFields {
	const name = input.name.trim()
	if (!name) throw bad('name обязателен')
	if (name.length > ROLE_NAME_MAX) throw bad(`name длиннее ${ROLE_NAME_MAX} символов`)
	const instructions = input.instructions.trim()
	if (!instructions) throw bad('instructions обязательны')
	if (instructions.length > ROLE_INSTRUCTIONS_MAX) throw bad(`instructions длиннее ${ROLE_INSTRUCTIONS_MAX} символов`)
	const description = (input.description ?? '').replace(/\s+/g, ' ').trim()
	if (description.length > ROLE_DESCRIPTION_MAX) throw bad(`description длиннее ${ROLE_DESCRIPTION_MAX} символов`)
	const id = input.id === undefined ? roleSlug(name) : input.id.trim()
	if (!isRoleId(id)) throw bad(`id «${id}» должен состоять из [a-z0-9-] (до ${ROLE_ID_MAX} символов)`)
	const color = input.color ?? roleColor(name)
	if (!Number.isFinite(color) || color < 0 || color > 360) throw bad('color — число 0..360')
	return { id, name, description, instructions, color: Math.round(color) }
}
