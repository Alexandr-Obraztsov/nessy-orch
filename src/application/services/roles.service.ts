/** Роли субагентов: хранение (roles.json), CRUD, разрешение по id или имени. Правила полей — domain/roles.ts. */
import type { RoleRequest, RoleView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { formatRolePreset, parseRolePreset } from '../../domain/role-presets'
import { validateRole } from '../../domain/roles'
import type { RoleFields, RolePresetFile, RoleSeedResult } from '../../domain/types'
import type { ServiceContext } from './context.types'

export class RolesService {
	private readonly roles = new Map<string, RoleView>()

	constructor(private readonly ctx: ServiceContext) {}

	load(): void {
		this.roles.clear()
		for (const r of this.ctx.store.loadRoles()) this.roles.set(r.id, r)
	}

	get count(): number {
		return this.roles.size
	}

	list(): RoleView[] {
		return [...this.roles.values()].sort((a, b) => a.name.localeCompare(b.name))
	}

	/** Роль по id (null — нет, например удалена). */
	find(id: string | null): RoleView | null {
		return id === null ? null : (this.roles.get(id) ?? null)
	}

	/** Роль по id или имени (без учёта регистра); неизвестная → 404 no_role. */
	resolve(ref: string): RoleView {
		const key = ref.trim().toLowerCase()
		const hit = this.roles.get(key) ?? [...this.roles.values()].find(r => r.id === key || r.name.toLowerCase() === key)
		if (!hit) throw new AppError(404, 'no_role', `роль «${ref}» не найдена`)
		return hit
	}

	create(req: RoleRequest): RoleView {
		const f = validateRole(req)
		if (this.roles.has(f.id)) throw new AppError(409, 'role_exists', `роль с id «${f.id}» уже есть`)
		this.assertNameFree(f.name, null)
		const now = this.isoNow()
		const role: RoleView = { ...this.view(f), createdAt: now, updatedAt: now }
		this.put(role)
		return role
	}

	/** Поля роли → вид: пакет (если задан) копируется в каталог оркестратора; без packageDir прежний пакет сохраняется. */
	private view(f: RoleFields, prevPackage = false): Omit<RoleView, 'createdAt' | 'updatedAt'> {
		const { packageDir, ...rest } = f
		if (packageDir) {
			this.ctx.rolePackages.install(f.id, packageDir)
			return { ...rest, package: true }
		}
		return prevPackage ? { ...rest, package: true } : rest
	}

	/** Полная замена полей роли (id не меняется; цвет без значения сохраняется прежним). */
	update(id: string, req: RoleRequest): RoleView {
		const prev = this.resolve(id)
		const icon = req.icon ?? prev.icon
		// model/runtime: без значения остаются прежними, null (для model ещё и пустая строка) — убираются
		const model = req.model === undefined ? prev.model : req.model
		const runtime = req.runtime === undefined ? prev.runtime : req.runtime
		const f = validateRole({
			...req,
			id: prev.id,
			color: req.color ?? prev.color,
			...(typeof icon === 'string' ? { icon } : {}),
			model: model ?? null,
			runtime: runtime ?? null,
		})
		this.assertNameFree(f.name, prev.id)
		const role: RoleView = { ...this.view(f, prev.package === true), createdAt: prev.createdAt, updatedAt: this.isoNow() }
		this.put(role)
		return role
	}

	/** Первичная заливка пресетов: невалидные и дубликаты молча пропускаются (попадают в invalid). */
	seed(files: readonly RolePresetFile[]): RoleSeedResult {
		const result: RoleSeedResult = { added: [], invalid: [] }
		for (const f of files) {
			try {
				result.added.push(this.create({ ...parseRolePreset(f.text), ...(f.packageDir ? { packageDir: f.packageDir } : {}) }).id)
			} catch {
				result.invalid.push(f.source)
			}
		}
		return result
	}

	/** Завести роли папку для файлов (скрипты, шаблоны); если пакет уже есть, ничего не меняется. */
	ensurePackage(id: string): RoleView {
		const prev = this.resolve(id)
		this.ctx.rolePackages.ensure(prev.id)
		if (prev.package) {
			this.mirror(prev)
			return prev
		}
		const role: RoleView = { ...prev, package: true, updatedAt: this.isoNow() }
		this.put(role)
		return role
	}

	/**
	 * Подхватить правки `role.md` из папки роли: описание и инструкции можно править в редакторе кода рядом со скриптами, а в окне «Роли» —
	 * как раньше. Ничего не изменилось — возвращается та же роль; role.md не читается — 400 с причиной (роль остаётся прежней).
	 */
	syncFromDisk(id: string): RoleView {
		const role = this.resolve(id)
		if (!role.package) return role
		const text = this.ctx.rolePackages.read(role.id, 'role.md')
		if (text === null) {
			this.mirror(role)
			return role
		}
		let parsed
		try {
			parsed = parseRolePreset(text)
		} catch (e) {
			throw new AppError(400, 'bad_role_md', `role.md: ${e instanceof Error ? e.message : String(e)}`)
		}
		const same =
			parsed.name === role.name &&
			(parsed.description ?? '') === role.description &&
			parsed.instructions.replace(/\n*$/, '') === role.instructions.replace(/\n*$/, '') &&
			(parsed.color ?? role.color) === role.color &&
			(parsed.icon ?? null) === (role.icon ?? null) &&
			(parsed.model ?? null) === (role.model ?? null) &&
			(parsed.runtime ?? null) === (role.runtime ?? null)
		// model/runtime без строки в role.md — убираются (файл — источник правды), а не сохраняются прежними
		return same ? role : this.update(role.id, { ...parsed, id: role.id, model: parsed.model ?? null, runtime: parsed.runtime ?? null })
	}

	/** role.md в папке роли повторяет роль: открыв папку в редакторе, видно и описание, и скрипты. */
	private mirror(role: RoleView): void {
		if (!role.package) return
		try {
			this.ctx.rolePackages.write(role.id, 'role.md', formatRolePreset({ ...role, color: role.color }))
		} catch {
			/* зеркало необязательно */
		}
	}

	/** Удалить роль. Агенты сохраняют id роли (приложение показывает её удалённой). */
	remove(id: string): void {
		const role = this.resolve(id)
		this.roles.delete(role.id)
		if (role.package) this.ctx.rolePackages.remove(role.id)
		this.save()
		this.ctx.hub.publish({ t: 'role_removed', id: role.id })
	}

	private put(role: RoleView): void {
		this.roles.set(role.id, role)
		this.mirror(role)
		this.save()
		this.ctx.hub.publish({ t: 'role', role })
	}

	private assertNameFree(name: string, exceptId: string | null): void {
		const n = name.toLowerCase()
		const clash = [...this.roles.values()].find(r => r.id !== exceptId && r.name.toLowerCase() === n)
		if (clash) throw new AppError(409, 'role_exists', `роль с именем «${name}» уже есть (${clash.id})`)
	}

	private save(): void {
		this.ctx.store.saveRoles(this.list())
	}

	private isoNow(): string {
		return new Date(this.ctx.clock.now()).toISOString()
	}
}
