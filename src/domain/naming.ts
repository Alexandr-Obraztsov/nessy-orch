import * as path from 'node:path'

/** Нормализовать абсолютный путь воркспейса (без хвостового слэша). */
export function normalizeWorkspacePath(p: string): string {
	return path.normalize(p).replace(/\/+$/, '') || '/'
}

/** Имя пространства по умолчанию — имя каталога. */
export function defaultSpaceName(p: string): string {
	return path.basename(p) || 'root'
}

/** Свободное имя: `name`, иначе `name-2`, `name-3`, … */
export function uniqueName(name: string, taken: (n: string) => boolean): string {
	if (!taken(name)) return name
	let i = 2
	while (taken(`${name}-${i}`)) i++
	return `${name}-${i}`
}
