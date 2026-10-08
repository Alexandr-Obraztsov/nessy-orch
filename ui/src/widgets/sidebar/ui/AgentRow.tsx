import { useState } from 'react'
import type { AgentView, RoleView } from '@contract'
import { agentStatusMeta } from '@/entities/agent'
import { AgentMenu } from '@/features/agent-actions'
import { duration } from '@/shared/lib/time'
import { openAgent } from '@/shared/model'
import { Icon, StatusDot } from '@/shared/ui'
import { Row } from './Row'
import s from './Sidebar.module.css'

export interface AgentRowProps {
	agent: AgentView
	role: RoleView | undefined
	depth: number
	active: boolean
	now: number
	/** показать пространство справа (в архиве — плоский список) */
	showSpace?: boolean
}

/** Строка агента: статус-точка, имя; справа — разрешение, очередь, таймер хода или роль. */
export function AgentRow({ agent: a, role, depth, active, now, showSpace }: AgentRowProps) {
	const [menu, setMenu] = useState(false)
	const st = agentStatusMeta(a)
	const working = a.status === 'working' && a.turnStartedAt
	const meta = (
		<>
			{a.pendingPermissions.length > 0 && (
				<span className={s.perm} title="Ждёт разрешения">
					<Icon name="shield" size={12} />
				</span>
			)}
			{a.queued > 0 && (
				<span className={s.queue} title={`В очереди: ${a.queued}`}>
					+{a.queued}
				</span>
			)}
			{working ? (
				<span className={s.timer}>{duration(a.turnStartedAt ?? now, now)}</span>
			) : showSpace ? (
				<span>{a.space}</span>
			) : role ? (
				<span>{role.name}</span>
			) : null}
		</>
	)
	return (
		<Row
			depth={depth}
			active={active}
			muted={a.archived}
			lead={<StatusDot color={st.color} pulse={st.pulse} size={7} />}
			name={a.name}
			meta={meta}
			title={`${a.name} — ${st.label}${a.error ? `: ${a.error}` : ''}`}
			label={a.name}
			onClick={() => openAgent(a.id)}
			onContextMenu={e => {
				e.preventDefault()
				setMenu(true)
			}}
			actions={<AgentMenu agent={a} open={menu} onOpenChange={setMenu} />}
		/>
	)
}
