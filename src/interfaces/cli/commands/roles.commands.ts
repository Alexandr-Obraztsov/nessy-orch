/** Команды ролей: role ls|add|show|rm. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RoleRequest, RoleView } from '../../../../shared/types'
import { errMsg } from '../../../lib/json'
import { flagBool, flagNum, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { CliError } from '../errors'
import { bold, dim, green, rolesTable } from '../format'
import { del, enc, get, json, out, post } from '../io'
import type { CommandTable } from './command.types'

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
	throw new CliError(`неизвестная подкоманда role ${sub}`, 2)
}

export const roleCommands: CommandTable = {
	role: { run: cmdRole, spec: { bool: ['json', 'help'], value: ['instructions', 'file', 'description', 'id', 'color'] } },
}
