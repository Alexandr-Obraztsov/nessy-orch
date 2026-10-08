import type { AgentStatus } from '@contract'
import { cssVars } from '@/shared/lib/style'
import { StatusDot } from '@/shared/ui'
import { AGENT_STATUS, ARCHIVED_STATUS } from '../lib/status'
import s from './AgentAvatar.module.css'

export interface AgentAvatarProps {
	/** имя агента; для оператора — 'you' */
	name: string
	/** устарело: цвет пространства больше не используется (оставлено для совместимости) */
	hue?: number
	/** hue роли агента — тогда аватар окрашен в цвет роли */
	roleHue?: number | null
	status?: AgentStatus
	archived?: boolean
	size?: number
	you?: boolean
}

/** Инициалы: «code-reviewer» → «CR», «nessy» → «NE». */
export function initials(name: string): string {
	const parts = name.split(/[\s\-_.]+/).filter(Boolean)
	if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
	return name.slice(0, 2).toUpperCase()
}

/** Компактный аватар: скруглённый квадрат с инициалами, нейтральный фон или цвет роли. */
export function AgentAvatar({ name, roleHue, status, archived, size = 24, you }: AgentAvatarProps) {
	const hasRole = !you && roleHue !== undefined && roleHue !== null
	const style = cssVars(
		hasRole ? { '--role-bg': `hsl(${roleHue} 60% 55% / 0.18)`, '--role-fg': `hsl(${roleHue} 65% 62%)` } : {},
		{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)), borderRadius: size <= 20 ? 4 : undefined },
	)
	const meta = status ? (archived && status !== 'working' && status !== 'starting' ? ARCHIVED_STATUS : AGENT_STATUS[status]) : null
	return (
		<span className={[s.avatar, hasRole && s.role, you && s.you].filter(Boolean).join(' ')} style={style} aria-hidden="true">
			{you ? 'Вы' : initials(name)}
			{meta && (
				<span className={s.badge}>
					<StatusDot color={meta.color} pulse={meta.pulse} size={Math.max(6, Math.round(size * 0.26))} />
				</span>
			)}
		</span>
	)
}
