import type { RoleView } from '@contract'
import { cssVars } from '@/shared/lib/style'
import { roleColor, roleSoft } from '../lib/color'
import s from './RoleBadge.module.css'

export interface RoleDotProps {
	hue: number
	size?: number
	title?: string
}

/** Цветная точка роли. */
export function RoleDot({ hue, size = 8, title }: RoleDotProps) {
	return <span className={s.dot} style={cssVars({ '--c': roleColor(hue) }, { width: size, height: size })} title={title} aria-hidden={!title} />
}

export interface RoleBadgeProps {
	role: Pick<RoleView, 'name' | 'color'>
	className?: string
}

/** Метка роли: точка + имя на мягком фоне цвета роли. */
export function RoleBadge({ role, className }: RoleBadgeProps) {
	return (
		<span className={[s.badge, className].filter(Boolean).join(' ')} style={cssVars({ '--c': roleColor(role.color), '--soft': roleSoft(role.color) })}>
			<span className={s.dot} style={{ width: 6, height: 6 }} />
			<span className={s.name}>{role.name}</span>
		</span>
	)
}

export interface RoleChipProps {
	name: string
	hue: number
	className?: string
}

/** Плашка роли в строке агента: имя на мягком фоне цвета роли (без точки). */
export function RoleChip({ name, hue, className }: RoleChipProps) {
	return (
		<span className={[s.chip, className].filter(Boolean).join(' ')} style={cssVars({ '--h': Math.round(hue) })} title={name}>
			{name}
		</span>
	)
}
