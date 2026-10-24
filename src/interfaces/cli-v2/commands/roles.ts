/**
 * Команды ролей cli-v2: role ls|show|add|rm. Импорт/экспорт markdown-ролей — семантика текущего CLI.
 */
import type { GraphView, RoleRequest, RoleView } from '../../../../shared/types'
import { flagBool, flagNum, flagStr } from '../../cli/args'
import { bold, dim, green } from '../../cli/format'
import { CliError } from '../../cli/errors'
import type { Ctx } from '../ctx'
import { ROLE_FLAGS } from '../flags'
import type { CommandTable } from './command.types'

async function cmdRole(c: Ctx): Promise<void> {
	const { p, t } = c
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls' || sub === undefined) {
		const g = await t.get<GraphView>('/graph')
		if (asJson) return c.json(g.roles)
		if (!g.roles.length) return c.out(dim('ролей нет. Добавьте: nessy-orch role add <имя> --instructions "…"'))
		for (const r of g.roles) c.out(`${bold(r.id)}  ${dim(r.name)}  ${dim(r.description.slice(0, 60))}${r.package ? dim(' · пакет') : ''}`)
		return
	}
	if (sub === 'show') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role show <id>', 2)
		const r = await t.get<RoleView>(`/roles/${encodeURIComponent(id)}`)
		if (asJson) return c.json(r)
		c.out(`${bold(r.id)}  ${r.name}  ${dim(r.description)}`)
		c.out('')
		c.out(r.instructions)
		return
	}
	if (sub === 'add') {
		const name = rest.join(' ').trim()
		const instructions = flagStr(p, 'instructions')
		if (!name || !instructions) throw new CliError('использование: nessy-orch role add <имя> --instructions "…"', 2)
		const description = flagStr(p, 'description')
		const color = flagNum(p, 'color')
		const icon = flagStr(p, 'icon')
		const id = flagStr(p, 'id')
		const body: RoleRequest = {
			name,
			instructions,
			...(description !== undefined ? { description } : {}),
			...(color !== undefined ? { color } : {}),
			...(icon !== undefined ? { icon } : {}),
			...(id !== undefined ? { id } : {}),
		}
		const r = await t.post<RoleView>('/roles', body)
		return asJson ? c.json(r) : c.out(`${green('✓')} роль ${bold(r.id)} добавлена`)
	}
	if (sub === 'rm') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role rm <id>', 2)
		await t.del(`/roles/${encodeURIComponent(id)}`)
		return c.out(`${green('✓')} роль удалена: ${id}`)
	}
	throw new CliError(`неизвестная подкоманда role ${sub}\nиспользование: role ls|show|add|rm`, 2)
}

export const roleCommands: CommandTable = {
	role: { run: cmdRole, spec: ROLE_FLAGS },
}
