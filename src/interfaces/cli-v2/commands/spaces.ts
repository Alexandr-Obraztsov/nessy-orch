/**
 * Команды пространств cli-v2: space add|ls|rm.
 */
import * as path from 'node:path'
import type { GraphView, SpaceRequest, SpaceView } from '../../../../shared/types'
import { flagBool, flagStr } from '../../cli/args'
import { bold, dim, green } from '../../cli/format'
import { CliError } from '../../cli/errors'
import type { Ctx } from '../ctx'
import { SPACE_FLAGS } from '../flags'
import type { CommandTable } from './command.types'

async function cmdSpace(c: Ctx): Promise<void> {
	const { p, t, cwd } = c
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls' || sub === undefined) {
		const g = await t.get<GraphView>('/graph')
		if (asJson) return c.json(g.spaces)
		if (!g.spaces.length) return c.out(dim('пространств нет. Добавьте: nessy-orch space add <путь>'))
		for (const s of g.spaces) c.out(`${bold(s.name)}  ${s.status}  ${s.mode}  ${dim(s.path)}${s.error ? `  ${s.error}` : ''}`)
		return
	}
	if (sub === 'add') {
		const pArg = rest[0]
		if (!pArg) throw new CliError('использование: nessy-orch space add <путь> [--name N] [--url URL]', 2)
		const name = flagStr(p, 'name')
		const url = flagStr(p, 'url')
		const body: SpaceRequest = {
			path: path.resolve(cwd, pArg),
			...(name !== undefined ? { name } : {}),
			...(url !== undefined ? { url } : {}),
		}
		const s = await t.post<SpaceView>('/spaces', body)
		return asJson ? c.json(s) : c.out(`${green('✓')} пространство ${bold(s.name)} добавлено (${s.status})`)
	}
	if (sub === 'rm') {
		const name = rest[0]
		if (!name) throw new CliError('использование: nessy-orch space rm <имя> [--force]', 2)
		await t.del(`/spaces/${encodeURIComponent(name)}`)
		return c.out(`${green('✓')} пространство удалено: ${name}`)
	}
	throw new CliError(`неизвестная подкоманда space ${sub}\nиспользование: space add|ls|rm`, 2)
}

export const spaceCommands: CommandTable = {
	space: { run: cmdSpace, spec: SPACE_FLAGS },
}
