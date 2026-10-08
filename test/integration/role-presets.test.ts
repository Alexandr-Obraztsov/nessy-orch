/** Пресеты ролей: заливка при первом запуске и импорт/экспорт на уровне функций CLI. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import type { RoleView } from '../../shared/types'
import { formatRolePreset } from '../../src/domain/role-presets'
import { readRolePresetFiles } from '../../src/infrastructure/persistence/role-presets'
import { importRolePresets } from '../../src/interfaces/cli/commands/roles-import'
import type { RolesApi } from '../../src/interfaces/cli/commands/roles-import.types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 25000 }
const preset = (id: string, name: string, body = 'Инструкции'): string => `---\nid: ${id}\nname: ${name}\ncolor: 40\n---\n${body}\n`

function tmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-presets-'))
}

function presetsDir(base: string): string {
	const dir = path.join(base, 'roles')
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, 'README.md'), '# описание формата\n')
	fs.writeFileSync(path.join(dir, 'alpha.md'), preset('alpha', 'Альфа'))
	fs.writeFileSync(path.join(dir, 'beta.md'), preset('beta', 'Бета', 'Другой текст'))
	fs.writeFileSync(path.join(dir, 'broken.md'), 'нет frontmatter\n')
	return dir
}

describe('пресеты ролей: заливка при первом запуске', () => {
	const open: Harness[] = []
	const dirs: string[] = []
	after(async () => {
		for (const h of open) await h.close()
		for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
	})
	const roles = async (h: Harness): Promise<RoleView[]> => (await h.api<RoleView[]>('GET', '/roles')).body

	it('первый старт заливает валидные, рестарт и существующий roles.json — нет', T, async () => {
		const base = tmp()
		dirs.push(base)
		const rolesDir = presetsDir(base)
		const h1 = await startHarness({ base, config: { seedRoles: true, rolesDir } })
		const ids = (await roles(h1)).map(r => r.id).sort()
		assert.deepEqual(ids, ['alpha', 'beta'])
		await h1.api('DELETE', '/roles/beta')
		await h1.close({ keepFiles: true })

		const h2 = await startHarness({ base, config: { seedRoles: true, rolesDir } })
		open.push(h2)
		assert.deepEqual((await roles(h2)).map(r => r.id), ['alpha'], 'beta не вернулась после рестарта')
	})

	it('при существующем (даже пустом) roles.json не заливается', T, async () => {
		const base = tmp()
		dirs.push(base)
		const rolesDir = presetsDir(base)
		fs.mkdirSync(path.join(base, 'home'), { recursive: true })
		fs.writeFileSync(path.join(base, 'home', 'roles.json'), '{"roles":[]}')
		const h = await startHarness({ base, config: { seedRoles: true, rolesDir } })
		open.push(h)
		assert.deepEqual(await roles(h), [])
	})

	it('seedRoles=false и отсутствующий каталог — без ролей и без ошибок', T, async () => {
		const base = tmp()
		dirs.push(base)
		const off = await startHarness({ base, config: { seedRoles: false, rolesDir: presetsDir(base) } })
		assert.deepEqual(await roles(off), [])
		await off.close()
		const base2 = tmp()
		dirs.push(base2)
		const none = await startHarness({ base: base2, config: { seedRoles: true, rolesDir: path.join(base2, 'нет-такого') } })
		open.push(none)
		assert.deepEqual(await roles(none), [])
	})
})

describe('пресеты ролей: импорт и экспорт', () => {
	let h: Harness | null = null
	const base = tmp()
	after(async () => {
		await h?.close()
		fs.rmSync(base, { recursive: true, force: true })
	})

	it('создать / пропустить / --force / --dry-run / невалидные, export → import', T, async () => {
		h = await startHarness()
		const hh = h
		const api: RolesApi = {
			list: async () => (await hh.api<RoleView[]>('GET', '/roles')).body,
			create: async body => {
				const r = await hh.api<RoleView & { error?: string }>('POST', '/roles', body)
				if (r.status >= 400) throw new Error(r.body.error)
				return r.body
			},
			update: async (id, body) => {
				const r = await hh.api<RoleView & { error?: string }>('PUT', `/roles/${id}`, body)
				if (r.status >= 400) throw new Error(r.body.error)
				return r.body
			},
		}
		const files = readRolePresetFiles(presetsDir(base))
		assert.deepEqual(files.map(f => f.source), ['alpha.md', 'beta.md', 'broken.md'], 'README пропущен')

		const dry = await importRolePresets(files, api, { force: false, dryRun: true })
		assert.deepEqual(dry.map(r => r.outcome), ['created', 'created', 'invalid'])
		assert.equal((await api.list()).length, 0, 'dry-run ничего не создаёт')

		const first = await importRolePresets(files, api, { force: false, dryRun: false })
		assert.deepEqual(first.map(r => r.action), ['создана', 'создана', first[2]?.action])
		assert.match(first[2]?.action ?? '', /^пропущена: /)
		assert.equal((await api.list()).length, 2)

		const again = await importRolePresets(files, api, { force: false, dryRun: false })
		assert.deepEqual(again.map(r => r.action).slice(0, 2), ['пропущена: уже есть', 'пропущена: уже есть'])

		fs.writeFileSync(path.join(base, 'roles', 'alpha.md'), preset('alpha', 'Альфа', 'Новый текст'))
		const forced = await importRolePresets(readRolePresetFiles(path.join(base, 'roles', 'alpha.md')), api, { force: true, dryRun: false })
		assert.equal(forced[0]?.outcome, 'updated')
		assert.equal((await hh.api<RoleView>('GET', '/roles/alpha')).body.instructions, 'Новый текст')

		// конфликт имени → ошибка в строке, а не падение
		const clash = await importRolePresets([{ source: 'x.md', text: preset('gamma', 'Бета') }], api, { force: false, dryRun: false })
		assert.equal(clash[0]?.outcome, 'failed')

		// экспорт → импорт в «чистый» оркестратор даёт ту же роль
		const exported = formatRolePreset((await hh.api<RoleView>('GET', '/roles/beta')).body)
		await hh.api('DELETE', '/roles/beta')
		const back = await importRolePresets([{ source: 'beta.md', text: exported }], api, { force: false, dryRun: false })
		assert.equal(back[0]?.outcome, 'created')
		const beta = (await hh.api<RoleView>('GET', '/roles/beta')).body
		assert.equal(beta.name, 'Бета')
		assert.equal(beta.color, 40)
		assert.equal(beta.instructions, 'Другой текст')
	})
})
