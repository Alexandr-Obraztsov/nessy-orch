/** Чтение пресетов ролей (markdown) с диска: файл или каталог. Разбор — в domain/role-presets. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RolePresetSource } from '../../application/ports'
import type { RolePresetFile } from '../../domain/types'

/** Читает один файл либо все `*.md` каталога (README.md пропускается), по имени. Нет пути — пусто. */
export function readRolePresetFiles(target: string): RolePresetFile[] {
	let stat: fs.Stats
	try {
		stat = fs.statSync(target)
	} catch {
		return []
	}
	if (stat.isFile()) {
		const file: RolePresetFile = { source: path.basename(target), text: fs.readFileSync(target, 'utf8') }
		// role.md внутри папки — пакет роли: рядом лежат её файлы
		if (path.basename(target).toLowerCase() === 'role.md') file.packageDir = path.dirname(path.resolve(target))
		return [file]
	}
	const files: RolePresetFile[] = []
	for (const name of fs.readdirSync(target).sort()) {
		if (!name.toLowerCase().endsWith('.md') || name.toLowerCase() === 'readme.md') continue
		const p = path.join(target, name)
		try {
			if (fs.statSync(p).isFile()) files.push({ source: name, text: fs.readFileSync(p, 'utf8') })
		} catch {
			/* файл пропал или нечитаем — пропускаем */
		}
	}
	// пакеты ролей: <каталог>/<id>/role.md, остальные файлы папки — содержимое пакета
	for (const name of fs.readdirSync(target).sort()) {
		const dir = path.join(target, name)
		const md = path.join(dir, 'role.md')
		try {
			if (fs.statSync(dir).isDirectory() && fs.statSync(md).isFile()) files.push({ source: `${name}/role.md`, text: fs.readFileSync(md, 'utf8'), packageDir: dir })
		} catch {
			/* не пакет — пропускаем */
		}
	}
	return files
}

export class FileRolePresets implements RolePresetSource {
	constructor(private readonly target: string) {}

	read(): RolePresetFile[] {
		return readRolePresetFiles(this.target)
	}
}
