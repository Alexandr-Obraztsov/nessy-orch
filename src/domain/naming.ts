import * as path from 'node:path'

/** Нормализовать абсолютный путь воркспейса (без хвостового слэша). */
export function normalizeWorkspacePath(p: string): string {
	return path.normalize(p).replace(/\/+$/, '') || '/'
}

/** Имя пространства по умолчанию — имя каталога. */
export function defaultSpaceName(p: string): string {
	return path.basename(p) || 'root'
}

/** Заголовок агента: пробелы схлопнуты, до 80 знаков; пусто → null. */
export function cleanTitle(raw: string | undefined | null): string | null {
	const t = (raw ?? '').replace(/\s+/g, ' ').trim()
	if (!t) return null
	return t.length > 80 ? `${t.slice(0, 79)}…` : t
}

/** Свободное имя: `name`, иначе `name-2`, `name-3`, … */
export function uniqueName(name: string, taken: (n: string) => boolean): string {
	if (!taken(name)) return name
	let i = 2
	while (taken(`${name}-${i}`)) i++
	return `${name}-${i}`
}

const TRANSLIT: Record<string, string> = {
	а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
	н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
	ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Латинский slug из названия (кириллица транслитерируется), до 40 знаков; пусто → fallback. */
export function slugify(text: string, fallback: string): string {
	const latin = Array.from(text.toLowerCase(), ch => TRANSLIT[ch] ?? ch).join('')
	const slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
	return slug || fallback
}
