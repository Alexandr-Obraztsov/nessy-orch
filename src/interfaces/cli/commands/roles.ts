/**
 * Команды ролей: role ls|show|add|update|rm|import. import — загрузка markdown-пресетов (roles-import).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { GraphView, RoleRequest, RoleView, RuntimeId } from '../../../../shared/types'
import { projectRoot } from '../../../infrastructure/config/load-config'
import { readRolePresetFiles } from '../../../infrastructure/persistence/role-presets'
import { flagBool, flagNum, flagStr } from '../args'
import { bold, dim, green, red, roleModelCell, table, yellow } from '../format'
import { CliError } from '../errors'
import type { Ctx } from '../ctx'
import { ROLE_FLAGS } from '../flags'
import { parseRuntimeId } from '../runtime-id'
import type { CommandTable } from './command.types'
import { importRolePresets } from './roles-import'

/** role import [путь] [--force] [--dry-run]: путь — файл или каталог (по умолчанию roles/ проекта). */
async function cmdImport(c: Ctx, target: string | undefined): Promise<void> {
	const { p, t } = c
	const dir = target === undefined ? path.join(projectRoot(), 'roles') : path.resolve(target)
	if (!fs.existsSync(dir)) throw new CliError(`не найдено: ${dir}`, 2)
	const files = readRolePresetFiles(dir)
	if (!files.length) throw new CliError(`в ${dir} нет файлов *.md`, 2)
	const dryRun = flagBool(p, 'dry-run')
	const rows = await importRolePresets(
		files,
		{
			list: () => t.get<RoleView[]>('/roles'),
			create: body => t.post<RoleView>('/roles', body),
			update: (id, body) => t.put<RoleView>(`/roles/${encodeURIComponent(id)}`, body),
		},
		{ force: flagBool(p, 'force'), dryRun },
	)
	if (flagBool(p, 'json')) c.json(rows)
	else {
		const paint = { created: green, updated: green, skipped: dim, invalid: yellow, failed: red }
		c.out(
			table(
				rows.map(r => [bold(r.id), r.name, paint[r.outcome](r.action)]),
				['ID', 'ИМЯ', 'ДЕЙСТВИЕ'],
			),
		)
		if (dryRun) c.info(dim('--dry-run: ничего не изменено'))
	}
	if (rows.some(r => r.outcome === 'failed')) throw new CliError('часть ролей не импортирована', 1)
}

/** --model: пустая строка убирает модель роли (null), иначе строка как есть; флага нет — поле не трогаем. */
function modelFlag(c: Ctx): { model?: string | null } {
	const v = flagStr(c.p, 'model')
	if (v === undefined) return {}
	const m = v.trim()
	return { model: m === '' ? null : m }
}

/** --runtime: пустая строка убирает рантайм роли (null), иначе nessy-sdk|tclaude; флага нет — поле не трогаем. */
function runtimeFlag(c: Ctx): { runtime?: RuntimeId | null } {
	const v = flagStr(c.p, 'runtime')
	if (v === undefined) return {}
	if (v.trim() === '') return { runtime: null }
	const r = parseRuntimeId(v.trim())
	return r === undefined ? {} : { runtime: r }
}

/** role update <id> [--instructions|--file] [--description] [--color] [--icon] [--model] [--runtime]: меняет только переданное. */
async function cmdUpdate(c: Ctx, id: string | undefined, nameParts: string[]): Promise<void> {
	const { p, t } = c
	if (!id) throw new CliError('использование: nessy-orch role update <id> [--model M] [--runtime nessy-sdk|tclaude] [--instructions "…"|--file F] [--description D] [--color 0..360] [--icon SF]', 2)
	const cur = await t.get<RoleView>(`/roles/${encodeURIComponent(id)}`)
	const file = flagStr(p, 'file')
	const instructions = flagStr(p, 'instructions') ?? (file !== undefined ? fs.readFileSync(path.resolve(file), 'utf8') : cur.instructions)
	const description = flagStr(p, 'description')
	const color = flagNum(p, 'color')
	const icon = flagStr(p, 'icon')
	const name = nameParts.join(' ').trim()
	const body: RoleRequest = {
		name: name || cur.name,
		instructions,
		...(description !== undefined ? { description } : {}),
		...(color !== undefined ? { color } : {}),
		...(icon !== undefined ? { icon } : {}),
		...modelFlag(c),
		...runtimeFlag(c),
	}
	const r = await t.put<RoleView>(`/roles/${encodeURIComponent(id)}`, body)
	if (flagBool(p, 'json')) return c.json(r)
	c.out(`${green('✓')} роль ${bold(r.id)} обновлена  ${roleModelCell(r)}`)
}

async function cmdRole(c: Ctx): Promise<void> {
	const { p, t } = c
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls' || sub === undefined) {
		const g = await t.get<GraphView>('/graph')
		if (asJson) return c.json(g.roles)
		if (!g.roles.length) return c.out(dim('ролей нет. Добавьте: nessy-orch role add <имя> --instructions "…"'))
		for (const r of g.roles)
			c.out(`${bold(r.id)}  ${dim(r.name)}  ${roleModelCell(r)}  ${dim(r.description.slice(0, 60))}${r.package ? dim(' · пакет') : ''}`)
		return
	}
	if (sub === 'show') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role show <id>', 2)
		const r = await t.get<RoleView>(`/roles/${encodeURIComponent(id)}`)
		if (asJson) return c.json(r)
		c.out(`${bold(r.id)}  ${r.name}  ${dim(r.description)}`)
		c.out(`${dim('рантайм')} ${r.runtime ?? dim('—')}  ${dim('модель')} ${r.model ?? dim('—')}`)
		c.out('')
		c.out(r.instructions)
		return
	}
	if (sub === 'add') {
		const name = rest.join(' ').trim()
		const file = flagStr(p, 'file')
		const instructions = flagStr(p, 'instructions') ?? (file !== undefined ? fs.readFileSync(path.resolve(file), 'utf8') : undefined)
		if (!name || !instructions) throw new CliError('использование: nessy-orch role add <имя> --instructions "…" | --file <путь> [--model M] [--runtime nessy-sdk|tclaude]', 2)
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
			...modelFlag(c),
			...runtimeFlag(c),
		}
		const r = await t.post<RoleView>('/roles', body)
		return asJson ? c.json(r) : c.out(`${green('✓')} роль ${bold(r.id)} добавлена`)
	}
	if (sub === 'update') return cmdUpdate(c, rest[0], rest.slice(1))
	if (sub === 'rm') {
		const id = rest[0]
		if (!id) throw new CliError('использование: nessy-orch role rm <id>', 2)
		await t.del(`/roles/${encodeURIComponent(id)}`)
		return c.out(`${green('✓')} роль удалена: ${id}`)
	}
	if (sub === 'import') return cmdImport(c, rest[0])
	throw new CliError(`неизвестная подкоманда role ${sub}\nиспользование: role ls|show|add|update|rm|import`, 2)
}

export const roleCommands: CommandTable = {
	role: { run: cmdRole, spec: ROLE_FLAGS },
}
