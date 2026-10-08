/**
 * Шапка чата (40px): аватар, имя, роль, пространство, статус (у работающего — таймер хода
 * и текущий инструмент), метка «в архиве»; действия — «Прервать», «В архив» / «Вернуть», меню ⋯.
 */
import { useMemo, useState } from 'react'
import { AgentMenu, useAgentActions } from '@/features/agent-actions'
import { AgentAvatar, agentStatusMeta } from '@/entities/agent'
import { hueColor } from '@/shared/lib/color'
import { cssVars } from '@/shared/lib/style'
import { duration } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { useStore } from '@/shared/model'
import { Icon, StatusDot } from '@/shared/ui'
import { roleBadge } from '../lib/roleBadge'
import { toolIcon } from '../lib/toolIcon'
import type { ChatHeaderProps } from '../model/types'
import s from './AgentChat.module.css'

export function ChatHeader({ agent }: ChatHeaderProps) {
	const roles = useStore(st => st.roles)
	const role = useMemo(() => roleBadge(agent.role, roles), [agent.role, roles])
	const actions = useAgentActions(agent)
	const [busy, setBusy] = useState<'cancel' | 'archive' | null>(null)
	const working = agent.status === 'working' || agent.status === 'starting'
	const st = agentStatusMeta({ status: agent.status, archived: false })

	const run = async (kind: 'cancel' | 'archive', fn: () => Promise<unknown>): Promise<void> => {
		setBusy(kind)
		try {
			await fn()
		} finally {
			setBusy(null)
		}
	}

	return (
		<header className={s.header}>
			<AgentAvatar name={agent.name} roleHue={role?.hue ?? null} size={22} />
			<h2 className={s.name} title={agent.displayName ? `${agent.name} · ${agent.displayName}` : agent.name}>
				{agent.name}
			</h2>
			{role && (
				<span
					className={[s.role, role.hue === null && s.roleGone].filter(Boolean).join(' ')}
					style={role.hue !== null ? cssVars({ '--rc': hueColor(role.hue), '--rb': hueColor(role.hue, 0.14) }) : undefined}
					title={role.hue === null ? 'Роль удалена' : `Роль: ${role.label}`}
				>
					{role.label}
				</span>
			)}
			<span className={s.space} title={`Пространство ${agent.space}`}>
				{agent.space}
			</span>
			<span className={s.status} title={agent.error ?? st.label}>
				{agent.archived ? (
					<span className={s.archived}>в архиве</span>
				) : (
					<>
						<StatusDot color={st.color} pulse={st.pulse} size={7} />
						<span className={s.statusLabel} style={{ color: agent.status === 'error' ? st.color : undefined }}>
							{st.label}
						</span>
						{working && <TurnInfo agent={agent} />}
					</>
				)}
				{agent.queued > 0 && <span className={s.queued}>в очереди {agent.queued}</span>}
			</span>
			<div className={s.actions}>
				{working && !agent.archived && (
					<button type="button" className={[s.act, s.stop].join(' ')} disabled={busy !== null || actions.busy} onClick={() => void run('cancel', actions.cancel)} title="Прервать текущий ход">
						{busy === 'cancel' ? <span className={s.spin} /> : <Icon name="stop" size={13} />}
						<span className={s.actLabel}>Прервать</span>
					</button>
				)}
				{agent.archived ? (
					<button type="button" className={s.act} disabled={busy !== null || actions.busy} onClick={() => void run('archive', actions.restore)} title="Вернуть из архива">
						{busy === 'archive' ? <span className={s.spin} /> : <Icon name="restore" size={13} />}
						<span className={s.actLabel}>Вернуть</span>
					</button>
				) : (
					<button type="button" className={s.act} disabled={busy !== null || actions.busy} onClick={() => void run('archive', actions.archive)} title="Убрать в архив (сессия сохранится)">
						{busy === 'archive' ? <span className={s.spin} /> : <Icon name="archive" size={13} />}
						<span className={s.actLabel}>В архив</span>
					</button>
				)}
				<AgentMenu agent={agent} />
			</div>
		</header>
	)
}

/** Таймер хода и текущий инструмент (перерисовывается раз в секунду только он). */
function TurnInfo({ agent }: ChatHeaderProps) {
	const now = useNow(1000)
	return (
		<>
			{agent.turnStartedAt && <time className={s.timer}>{duration(agent.turnStartedAt, now)}</time>}
			{agent.lastTool && (
				<span className={s.tool} title={agent.lastTool.title}>
					<Icon name={toolIcon(agent.lastTool.name)} size={12} />
					<span className={s.toolText}>{agent.lastTool.title}</span>
				</span>
			)}
		</>
	)
}
