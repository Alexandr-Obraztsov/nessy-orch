/** Пакеты ролей: папка с role.md и файлами копируется в каталог оркестратора, {{role_dir}} во вводной заменяется путём копии. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import type { ApiError, RoleView } from '../../shared/types'
import { readRolePresetFiles } from '../../src/infrastructure/persistence/role-presets'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 25000 }

function makePackage(base: string): string {
	const dir = path.join(base, 'roles', 'pkg')
	fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
	fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
	fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'role.md'), '---\nid: pkg\nname: Пакетная роль\n---\nЗапусти {{role_dir}}/scripts/run.sh и прочитай {{role_dir}}/assets/a.txt\n')
	fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), '#!/bin/sh\necho ok\n', { mode: 0o755 })
	fs.writeFileSync(path.join(dir, 'assets', 'a.txt'), 'шаблон\n')
	fs.writeFileSync(path.join(dir, '.git', 'config'), 'служебное')
	fs.symlinkSync('/etc/hosts', path.join(dir, 'assets', 'link'))
	return path.join(base, 'roles')
}

describe('роли-пакеты', () => {
	let h: Harness | null = null
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-pkg-'))
	after(async () => {
		await h?.close()
		fs.rmSync(base, { recursive: true, force: true })
	})

	it('читатель пресетов находит папки с role.md и отдаёт packageDir', () => {
		const files = readRolePresetFiles(makePackage(base))
		assert.deepEqual(files.map(f => [f.source, path.basename(f.packageDir ?? '')]), [['pkg/role.md', 'pkg']])
	})

	it('первый старт: пакет скопирован (без .git и ссылок, исполняемость сохранена), путь подставлен во вводную агента', T, async () => {
		const rolesDir = path.join(base, 'roles')
		h = await startHarness({ base, config: { seedRoles: true, rolesDir } })
		const hh = h
		const role = (await hh.api<RoleView[]>('GET', '/roles')).body.find(r => r.id === 'pkg')
		assert.equal(role?.package, true)
		const copy = path.join(hh.home, 'role-packages', 'pkg')
		assert.ok(fs.existsSync(path.join(copy, 'assets', 'a.txt')))
		assert.ok(!fs.existsSync(path.join(copy, '.git')), 'служебные папки не копируются')
		assert.ok(!fs.existsSync(path.join(copy, 'assets', 'link')), 'символьные ссылки не копируются')
		assert.ok((fs.statSync(path.join(copy, 'scripts', 'run.sh')).mode & 0o100) !== 0, 'скрипт остался исполняемым')
		await hh.api('POST', '/spaces', { path: hh.ws, name: 'main' })
		await hh.api('POST', '/agents', { space: 'main', name: 'p1', role: 'pkg' })
		const text = hh.orch.preambleFor(hh.orch.resolveAgent('p1'))
		assert.ok(text.includes(`${copy}/scripts/run.sh`), 'во вводной вместо {{role_dir}} стоит путь копии')
		assert.ok(!text.includes('{{role_dir}}'))
		// инструкции в самой роли остаются с плейсхолдером (путь зависит от машины)
		assert.ok((await hh.api<RoleView>('GET', '/roles/pkg')).body.instructions.includes('{{role_dir}}'))
	})

	it('POST /roles/:id/package: пустая папка для файлов создаётся, роль помечается пакетом', T, async () => {
		const hh = h
		assert.ok(hh)
		const made = await hh.api<RoleView>('POST', '/roles', { name: 'Без файлов', instructions: 'x', id: 'plain' })
		assert.equal(made.body.package, undefined)
		const r = await hh.api<RoleView>('POST', '/roles/plain/package')
		assert.equal(r.status, 200)
		assert.equal(r.body.package, true)
		assert.ok(fs.existsSync(path.join(hh.home, 'role-packages', 'plain', 'README.md')))
		assert.equal((await hh.api<RoleView>('POST', '/roles/plain/package')).body.package, true, 'повтор безопасен')
		await hh.api('DELETE', '/roles/plain')
	})

	it('role.md в папке роли: зеркало роли, правки из редактора подхватываются через /sync, ошибки не ломают роль', T, async () => {
		const hh = h
		assert.ok(hh)
		await hh.api<RoleView>('POST', '/roles', { name: 'Зеркало', instructions: 'Исходные инструкции', description: 'опис', id: 'mirror' })
		await hh.api('POST', '/roles/mirror/package')
		const md = path.join(hh.home, 'role-packages', 'mirror', 'role.md')
		assert.ok(fs.readFileSync(md, 'utf8').includes('Исходные инструкции'), 'role.md повторяет роль')
		// правка в окне ролей попадает в файл
		await hh.api('PUT', '/roles/mirror', { name: 'Зеркало', instructions: 'Из окна', description: 'опис' })
		assert.ok(fs.readFileSync(md, 'utf8').includes('Из окна'))
		// правка в редакторе кода → роль
		fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace('Из окна', 'Из редактора').replace('опис', 'новое описание'))
		const synced = await hh.api<RoleView>('POST', '/roles/mirror/sync')
		assert.equal(synced.status, 200)
		assert.equal(synced.body.instructions.trim(), 'Из редактора')
		assert.equal(synced.body.description, 'новое описание')
		assert.equal((await hh.api<RoleView>('GET', '/roles/mirror')).body.instructions.trim(), 'Из редактора')
		// без изменений — роль та же
		assert.equal((await hh.api<RoleView>('POST', '/roles/mirror/sync')).body.updatedAt, synced.body.updatedAt)
		// сломанный role.md — 400, роль прежняя
		fs.writeFileSync(md, 'просто текст без frontmatter')
		const bad = await hh.api<ApiError>('POST', '/roles/mirror/sync')
		assert.equal(bad.status, 400)
		assert.equal((await hh.api<RoleView>('GET', '/roles/mirror')).body.instructions.trim(), 'Из редактора')
		await hh.api('DELETE', '/roles/mirror')
	})

	it('правка роли без packageDir сохраняет пакет; удаление роли убирает копию; плохой путь — 400', T, async () => {
		const hh = h
		assert.ok(hh)
		const cur = (await hh.api<RoleView>('GET', '/roles/pkg')).body
		const upd = await hh.api<RoleView>('PUT', '/roles/pkg', { name: cur.name, instructions: `${cur.instructions}\nДополнение`, description: 'новое' })
		assert.equal(upd.body.package, true)
		const bad = await hh.api<ApiError>('POST', '/roles', { name: 'Плохая', instructions: 'x', packageDir: path.join(base, 'нет-такой-папки') })
		assert.equal(bad.status, 400)
		assert.equal(bad.body.code, 'bad_path')
		assert.equal((await hh.api<ApiError>('POST', '/roles', { name: 'Относительная', instructions: 'x', packageDir: 'rel/dir' })).status, 400)
		await hh.api('DELETE', '/agents/p1')
		assert.equal((await hh.api('DELETE', '/roles/pkg')).status, 200)
		assert.ok(!fs.existsSync(path.join(hh.home, 'role-packages', 'pkg')))
	})
})
