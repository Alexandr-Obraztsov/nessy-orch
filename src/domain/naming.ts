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
