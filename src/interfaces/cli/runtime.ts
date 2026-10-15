/**
 * Рабочая копия сервера для службы launchd: `~/.nessy-orch/runtime`. Служба смотрит туда, а не внутрь конкретной копии приложения, поэтому
 * несколько копий .app (разные версии, `release/`, `build/`) не перетягивают её друг у друга и не убивают чужой сервер при каждом запуске.
 * Копия обновляется только вперёд: старая версия приложения новую не затирает. Версия сборки — файл `VERSION` («1.0.<число коммитов>.<ггммддччмм>»),
 * его кладёт build-app.sh; у запуска из исходников (без VERSION) копии нет, служба смотрит прямо в проект.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Что копируем из корня сервера (dist/test и исходники не нужны). */
const ENTRIES = ['dist', 'bin', 'roles', 'package.json', 'VERSION']

export const runtimeDir = (home: string = os.homedir()): string => path.join(home, '.nessy-orch', 'runtime')

/** «1.0.231.2610151700» → [1, 0, 231, 2610151700]; не версия — null. */
export function parseBuild(v: string): number[] | null {
	const parts = v.trim().split('.')
	if (parts.length < 2 || parts.some(p => !/^\d+$/.test(p))) return null
	return parts.map(Number)
}

/** Сравнение версий сборки по числам: >0 — a новее b. Непонятная версия считается самой старой. */
export function compareBuild(a: string | null, b: string | null): number {
	const x = a === null ? null : parseBuild(a)
	const y = b === null ? null : parseBuild(b)
	if (!x && !y) return 0
	if (!x) return -1
	if (!y) return 1
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0)
		if (d !== 0) return d > 0 ? 1 : -1
	}
	return 0
}

export function readVersion(root: string): string | null {
	try {
		const v = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
		return v || null
	} catch {
		return null
	}
}

export interface RuntimePlan {
	/** корень, из которого должна работать служба */
	root: string
	/** копия обновлена этим вызовом (службу надо перезапустить) */
	copied: boolean
}

/**
 * Привести рабочую копию в порядок: у сборки с VERSION копируем её в `dest`, если там нет копии или в ней версия старее; новее или такая же —
 * не трогаем. Без VERSION (запуск из исходников) копии нет: корень — сам `src`.
 */
export function syncRuntime(src: string, dest: string): RuntimePlan {
	const version = readVersion(src)
	if (version === null || path.resolve(src) === path.resolve(dest)) return { root: version === null ? src : dest, copied: false }
	if (compareBuild(version, readVersion(dest)) <= 0 && fs.existsSync(path.join(dest, 'dist', 'src', 'main.js'))) return { root: dest, copied: false }
	const tmp = `${dest}.new-${process.pid}`
	fs.rmSync(tmp, { recursive: true, force: true })
	fs.mkdirSync(tmp, { recursive: true })
	try {
		for (const e of ENTRIES) {
			const from = path.join(src, e)
			if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, e), { recursive: true, dereference: false })
		}
		const old = `${dest}.old-${process.pid}`
		fs.rmSync(old, { recursive: true, force: true })
		if (fs.existsSync(dest)) fs.renameSync(dest, old)
		fs.renameSync(tmp, dest)
		fs.rmSync(old, { recursive: true, force: true })
	} catch (e) {
		fs.rmSync(tmp, { recursive: true, force: true })
		throw e
	}
	return { root: dest, copied: true }
}
