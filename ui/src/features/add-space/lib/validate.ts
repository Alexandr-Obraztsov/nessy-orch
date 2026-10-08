/** Последний сегмент пути — имя пространства по умолчанию (так же решает сервер). */
export function baseName(path: string): string {
	return path.trim().replace(/\/+$/, '').split('/').pop() ?? ''
}

export function pathError(path: string): string | null {
	const p = path.trim()
	if (!p) return 'Укажите путь к рабочей папке'
	if (!p.startsWith('/')) return 'Нужен абсолютный путь, начинающийся с «/»'
	return null
}

export function urlError(url: string): string | null {
	const u = url.trim()
	if (!u) return 'Укажите адрес запущенного nessy serve'
	if (!/^https?:\/\/[^\s/]+/.test(u)) return 'Адрес вида http://127.0.0.1:4096'
	return null
}
