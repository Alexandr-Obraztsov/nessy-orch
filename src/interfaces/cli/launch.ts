/** Запуск приложения из командной строки (чистые функции): ссылка «терминал в папке», разбор папки, сокращение `nessy-orch .`. */
import * as os from 'node:os'
import * as path from 'node:path'

/** Ссылка приложения «терминал в папке»: nessy-orch://terminal?dir=<абсолютный путь>. */
export function terminalUrl(dir: string): string {
	return `nessy-orch://terminal?dir=${encodeURIComponent(dir)}`
}

/** Папка из аргумента: ~ раскрывается, относительный путь — от текущего каталога; пусто — текущий каталог. */
export function resolveDir(arg: string | undefined, cwd: string = process.cwd(), home: string = os.homedir()): string {
	const a = (arg ?? '').trim()
	if (!a) return cwd
	if (a === '~') return home
	if (a.startsWith('~/')) return path.join(home, a.slice(2))
	return path.resolve(cwd, a)
}

/** `nessy-orch .`, `nessy-orch ~/proj`, `nessy-orch ../x` — сокращение для `app <папка>`. */
export function isPathArg(a: string | undefined): boolean {
	return a !== undefined && (a === '.' || a === '..' || a === '~' || a.startsWith('./') || a.startsWith('../') || a.startsWith('~/') || a.startsWith('/'))
}
