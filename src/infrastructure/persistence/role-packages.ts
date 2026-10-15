/**
 * Пакеты ролей на диске: `<home>/role-packages/<id>/` — копия папки роли (скрипты, шаблоны, команды…). Агент читает и запускает файлы
 * по абсолютному пути; в домашний каталог пользователя и в репозитории проектов ничего не пишется.
 * Копирование ограничено: без символьных ссылок и служебных папок, не больше MAX_FILES файлов и MAX_BYTES суммарно.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RolePackagePort } from '../../application/ports'
import { AppError } from '../../domain/errors'
import { isRoleId } from '../../domain/roles'

const MAX_FILES = 500
const MAX_BYTES = 20 * 1024 * 1024
const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__'])

export class FileRolePackages implements RolePackagePort {
	constructor(private readonly root: string) {}

	dirOf(id: string): string | null {
		if (!isRoleId(id)) return null
		const dir = path.join(this.root, id)
		return fs.existsSync(dir) ? dir : null
	}

	install(id: string, src: string): string {
		if (!isRoleId(id)) throw new AppError(400, 'bad_request', `id роли «${id}» не годится для пакета`)
		let stat: fs.Stats
		try {
			stat = fs.statSync(src)
		} catch {
			throw new AppError(400, 'bad_path', `папка пакета роли не найдена: ${src}`)
		}
		if (!stat.isDirectory()) throw new AppError(400, 'bad_path', `пакет роли — папка, а не файл: ${src}`)
		const dest = path.join(this.root, id)
		// копируем во временную папку и подменяем целиком: недокопированный пакет агент не увидит
		const tmp = `${dest}.tmp-${process.pid}`
		fs.rmSync(tmp, { recursive: true, force: true })
		fs.mkdirSync(tmp, { recursive: true })
		try {
			const budget = { files: 0, bytes: 0 }
			copyDir(fs.realpathSync(src), tmp, budget)
			fs.rmSync(dest, { recursive: true, force: true })
			fs.renameSync(tmp, dest)
		} catch (e) {
			fs.rmSync(tmp, { recursive: true, force: true })
			throw e
		}
		return dest
	}

	remove(id: string): void {
		if (!isRoleId(id)) return
		fs.rmSync(path.join(this.root, id), { recursive: true, force: true })
	}
}

function copyDir(from: string, to: string, budget: { files: number; bytes: number }): void {
	for (const name of fs.readdirSync(from).sort()) {
		if (SKIP.has(name)) continue
		const a = path.join(from, name)
		const b = path.join(to, name)
		const st = fs.lstatSync(a)
		if (st.isSymbolicLink()) continue // ссылка могла бы вывести за пределы пакета
		if (st.isDirectory()) {
			fs.mkdirSync(b)
			copyDir(a, b, budget)
		} else if (st.isFile()) {
			budget.files++
			budget.bytes += st.size
			if (budget.files > MAX_FILES || budget.bytes > MAX_BYTES) throw new AppError(400, 'package_too_big', `пакет роли больше лимита (${MAX_FILES} файлов, ${MAX_BYTES >> 20} МБ)`)
			fs.copyFileSync(a, b)
			fs.chmodSync(b, st.mode & 0o755) // исполняемость сохраняем, права на запись для остальных не даём
		}
	}
}
