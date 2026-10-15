/** Роли субагентов: хранение (roles.json), CRUD, разрешение по id или имени. Правила полей — domain/roles.ts. */
import type { RoleRequest, RoleView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { parseRolePreset } from '../../domain/role-presets'
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
		const f = validateRole({ ...req, id: prev.id, color: req.color ?? prev.color, icon: req.icon ?? prev.icon ?? undefined })
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

	/** Удалить роль. Агенты сохраняют id роли (UI показывает её удалённой). */
	remove(id: string): void {
		const role = this.resolve(id)
		this.roles.delete(role.id)
		if (role.package) this.ctx.rolePackages.remove(role.id)
		this.save()
		this.ctx.hub.publish({ t: 'role_removed', id: role.id })
	}

	private put(role: RoleView): void {
		this.roles.set(role.id, role)
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
