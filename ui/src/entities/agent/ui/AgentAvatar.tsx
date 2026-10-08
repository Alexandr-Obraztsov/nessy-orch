import type { AgentStatus } from '@contract'
import { cssVars } from '@/shared/lib/style'
import { StatusDot } from '@/shared/ui'
import { AGENT_STATUS } from '../lib/status'
import s from './AgentAvatar.module.css'

export interface AgentAvatarProps {
	/** имя агента; для оператора — 'you' */
	name: string
	/** hue пространства */
	hue?: number
	status?: AgentStatus
	size?: number
	you?: boolean
}

/** Инициалы: «code-reviewer» → «CR», «nessy» → «NE». */
export function initials(name: string): string {
	const parts = name.split(/[\s\-_.]+/).filter(Boolean)
	if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
	return name.slice(0, 2).toUpperCase()
}

export function AgentAvatar({ name, hue = 170, status, size = 32, you }: AgentAvatarProps) {
	const style = cssVars(
		{
			'--bg-c': `hsl(${hue} 60% 50% / 0.16)`,
			'--fg-c': `hsl(${hue} 75% 68%)`,
			'--ring-c': `hsl(${hue} 70% 60% / 0.45)`,
		},
		{ width: size, height: size, fontSize: Math.round(size * 0.36) },
	)
	const meta = status ? AGENT_STATUS[status] : null
	return (
		<span className={[s.avatar, you && s.you].filter(Boolean).join(' ')} style={style} aria-hidden="true">
			{you ? 'ВЫ' : initials(name)}
			{meta && (
				<span className={s.badge}>
					<StatusDot color={meta.color} pulse={meta.pulse} size={Math.max(7, Math.round(size * 0.24))} />
				</span>
			)}
		</span>
	)
}
