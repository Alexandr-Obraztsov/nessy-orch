/**
 * Строка агента: аватар со статусом, имя, время/таймер хода, статус или инструмент, превью, бейджи.
 */
import { memo, useEffect, useRef } from 'react'
import type { AgentView } from '@contract'
import { AGENT_STATUS, AgentAvatar } from '@/entities/agent'
import { ago, duration } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { openAgent } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { cssVars } from '@/shared/lib/style'
import s from './AgentRow.module.css'

/** Тикающее время: таймер хода у работающих, «N мин» у остальных. */
function When({ agent }: { agent: AgentView }) {
	const running = agent.status === 'working' && agent.turnStartedAt
	const now = useNow(running ? 1000 : 15000)
	if (running && agent.turnStartedAt) return <span className={`${s.when} ${s.timer}`}>{duration(agent.turnStartedAt, now)}</span>
	return <span className={s.when}>{ago(agent.lastActivityAt, now)}</span>
}

function statusLine(a: AgentView): { icon?: 'tool' | 'shield' | 'alert'; text: string } | null {
	if (a.pendingPermissions.length) return { icon: 'shield', text: a.pendingPermissions[0]?.title ?? 'ждёт разрешения' }
	if (a.status === 'error' && a.error) return { icon: 'alert', text: a.error }
	if (a.status === 'working' && a.lastTool) return { icon: 'tool', text: a.lastTool.title || a.lastTool.name }
	return null
}

export interface AgentRowProps {
	agent: AgentView
	hue: number
	selected: boolean
}

export const AgentRow = memo(function AgentRow({ agent: a, hue, selected }: AgentRowProps) {
	const st = AGENT_STATUS[a.status]
	const ref = useRef<HTMLButtonElement>(null)
	// выбранный (например, из графа) — прокручиваем в зону видимости
	useEffect(() => {
		if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	}, [selected])
	const line = statusLine(a)
	const perms = a.pendingPermissions.length
	const cls = [s.row, selected && s.selected, a.status === 'dead' && s.dead, perms > 0 && s.attn].filter(Boolean).join(' ')
	return (
		<button
			ref={ref}
			type="button"
			className={cls}
			onClick={() => openAgent(a.id)}
			aria-current={selected ? 'true' : undefined}
			title={a.displayName ? `${a.name} — ${a.displayName}` : a.name}
			style={cssVars({ '--st': st.color })}
		>
			<AgentAvatar name={a.name} hue={hue} status={a.status} size={34} />
			<span className={s.body}>
				<span className={s.top}>
					<span className={s.name}>{a.name}</span>
					{(a.queued > 0 || perms > 0) && (
						<span className={s.badges}>
							{a.queued > 0 && (
								<span className={s.badge} title={`В очереди сообщений: ${a.queued}`}>
									<Icon name="clock" size={11} />
									{a.queued}
								</span>
							)}
							{perms > 0 && (
								<span className={`${s.badge} ${s.badgePerm}`} title={`Ждёт разрешений: ${perms}`}>
									<Icon name="shield" size={11} />
									{perms}
								</span>
							)}
						</span>
					)}
					<When agent={a} />
				</span>
				<span className={s.mid}>
					<span className={s.status}>{st.label}</span>
					{line && (
						<span className={`${s.detail} ${line.icon === 'alert' ? s.detailErr : ''} ${line.icon === 'shield' ? s.detailPerm : ''}`}>
							{line.icon && <Icon name={line.icon} size={12} />}
							<span className={s.detailText}>{line.text}</span>
						</span>
					)}
				</span>
				{a.preview && <span className={s.preview}>{a.preview}</span>}
			</span>
		</button>
	)
})
