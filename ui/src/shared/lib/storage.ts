/**
 * Безопасный доступ к localStorage: в приватном окне, при запрете хранилища или в превью
 * доступ может бросить исключение — тогда настройка просто не запоминается.
 */
export function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

export function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		/* хранилище недоступно — не запомним */
	}
}
