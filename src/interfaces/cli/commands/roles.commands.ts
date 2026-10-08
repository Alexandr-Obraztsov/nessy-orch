/** Команды ролей: role ls|add|show|rm|import|export. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RoleRequest, RoleView } from '../../../../shared/types'
import { formatRolePreset } from '../../../domain/role-presets'
import { projectRoot } from '../../../infrastructure/config/load-config'
import { readRolePresetFiles } from '../../../infrastructure/persistence/role-presets'
import { errMsg } from '../../../lib/json'
import { flagBool, flagNum, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { CliError } from '../errors'
import { bold, dim, green, red, rolesTable, table, yellow } from '../format'
import { del, enc, get, info, json, out, post, put } from '../io'
import type { CommandTable } from './command.types'
import { importRolePresets } from './roles-import'

const ADD_USAGE = 'использование: nessy-orch role add <имя> --instructions "…" | --file <путь> [--description D] [--id ID] [--color 0..360]'

/** Инструкции из --instructions или из файла (--file). */
function readInstructions(p: Parsed): string {
	const inline = flagStr(p, 'instructions')
	const file = flagStr(p, 'file')
	if (inline !== undefined && file !== undefined) throw new CliError('укажите либо --instructions, либо --file', 2)
	if (inline !== undefined) return inline
	if (file === undefined) throw new CliError(ADD_USAGE, 2)
	try {
		return fs.readFileSync(path.resolve(file), 'utf8')
	} catch (e) {
		throw new CliError(`не удалось прочитать ${file}: ${errMsg(e)}`, 2)
	}
}

function printRole(r: RoleView): void {
	out(`${bold(r.id)}  ${r.name}${r.description ? dim(`  — ${r.description}`) : ''}`)
	out(r.instructions)
}

/** role import [путь] [--force] [--dry-run]: путь — файл или каталог (по умолчанию roles/ проекта). */
async function cmdImport(target: string | undefined, p: Parsed, asJson: boolean): Promise<void> {
	const dir = target === undefined ? path.join(projectRoot(), 'roles') : path.resolve(target)
	if (!fs.existsSync(dir)) throw new CliError(`не найдено: ${dir}`, 2)
	const files = readRolePresetFiles(dir)
	if (!files.length) throw new CliError(`в ${dir} нет файлов *.md`, 2)
	const dryRun = flagBool(p, 'dry-run')
	const rows = await importRolePresets(
		files,
		{
			list: () => get<RoleView[]>('/roles'),
			create: body => post<RoleView>('/roles', body),
			update: (id, body) => put<RoleView>(`/roles/${enc(id)}`, body),
		},
		{ force: flagBool(p, 'force'), dryRun },
	)
	if (asJson) json(rows)
	else {
		const paint = { created: green, updated: green, skipped: dim, invalid: yellow, failed: red }
		out(table(rows.map(r => [bold(r.id), r.name, paint[r.outcome](r.action)]), ['ID', 'ИМЯ', 'ДЕЙСТВИЕ']))
		if (dryRun) info(dim('--dry-run: ничего не изменено'))
	}
	if (rows.some(r => r.outcome === 'failed')) throw new CliError('часть ролей не импортирована', 1)
}

async function cmdRole(p: Parsed): Promise<void> {
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls' || sub === undefined) {
		const list = await get<RoleView[]>('/roles')
		return asJson ? json(list) : out(rolesTable(list))
	}
	if (sub === 'add') {
		const name = rest.join(' ').trim()
		if (!name) throw new CliError(ADD_USAGE, 2)
		const body: RoleRequest = {
			name,
			instructions: readInstructions(p),
			description: flagStr(p, 'description'),
			id: flagStr(p, 'id'),
			color: flagNum(p, 'color'),
		}
		const r = await post<RoleView>('/roles', body)
		return asJson ? json(r) : out(`${green('✓')} роль ${bold(r.id)} (${r.name}). Агент с ролью: nessy-orch spawn --role ${r.id} "задача"`)
	}
	if (sub === 'show') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role show <id>', 2)
		const r = await get<RoleView>(`/roles/${enc(id)}`)
		return asJson ? json(r) : printRole(r)
	}
	if (sub === 'rm') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role rm <id>', 2)
		await del(`/roles/${enc(id)}`)
		return out(`${green('✓')} роль удалена: ${id}`)
	}
	if (sub === 'import') return cmdImport(rest[0], p, asJson)
	if (sub === 'export') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role export <id> [--out файл]', 2)
		const text = formatRolePreset(await get<RoleView>(`/roles/${enc(id)}`))
		const file = flagStr(p, 'out')
		if (file === undefined) {
			process.stdout.write(text)
			return
		}
		fs.writeFileSync(path.resolve(file), text)
		return info(`${green('✓')} роль ${id} записана в ${file}`)
	}
	throw new CliError(`неизвестная подкоманда role ${sub}`, 2)
}

export const roleCommands: CommandTable = {
	role: { run: cmdRole, spec: { bool: ['json', 'help', 'force', 'dry-run'], value: ['instructions', 'file', 'description', 'id', 'color', 'out'] } },
}
