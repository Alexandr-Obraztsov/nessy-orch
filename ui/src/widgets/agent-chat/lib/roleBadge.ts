import type { RoleView } from '@contract'
import type { RoleBadgeView } from '../model/types'

/** Бейдж роли: имя и цвет; роль задана, но удалена — «роль удалена». */
export function roleBadge(roleId: string | null, roles: RoleView[]): RoleBadgeView | null {
	if (!roleId) return null
	const r = roles.find(x => x.id === roleId)
	return r ? { label: r.name, hue: r.color } : { label: 'роль удалена', hue: null }
}
