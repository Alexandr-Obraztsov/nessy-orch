/** Команды пространств: space ls|add|rm. */
import * as path from 'node:path'
import type { SpaceView } from '../../../../shared/types'
import { flagBool, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { CliError } from '../errors'
import { bold, green, spacesTable } from '../format'
import { del, enc, get, json, out, post } from '../io'
import type { CommandTable } from './command.types'

async function cmdSpace(p: Parsed): Promise<void> {
	const [sub, ...rest] = p.positionals
	if (sub === 'ls' || sub === undefined) {
		const list = await get<SpaceView[]>('/spaces')
		return flagBool(p, 'json') ? json(list) : out(spacesTable(list))
	}
	if (sub === 'add') {
		const target = rest[0]
		if (!target) throw new CliError('использование: nessy-orch space add <абсолютный путь> [--name N] [--url URL]', 2)
		const s = await post<SpaceView>('/spaces', { path: path.resolve(target), name: flagStr(p, 'name'), url: flagStr(p, 'url') })
		return flagBool(p, 'json') ? json(s) : out(`${green('✓')} пространство ${bold(s.name)} → ${s.path}`)
	}
	if (sub === 'rm') {
		const name = rest[0]
		if (!name) throw new CliError('использование: nessy-orch space rm <имя> [--force]', 2)
		await del(`/spaces/${enc(name)}${flagBool(p, 'force') ? '?force=1' : ''}`)
		return out(`${green('✓')} удалено: ${name}`)
	}
	throw new CliError(`неизвестная подкоманда space ${sub}`, 2)
}

export const spaceCommands: CommandTable = {
	space: { run: cmdSpace, spec: { bool: ['json', 'help', 'force'], value: ['name', 'url'] } },
}
