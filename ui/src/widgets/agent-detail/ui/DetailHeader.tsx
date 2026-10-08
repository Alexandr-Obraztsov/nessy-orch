/**
 * Шапка деталей: аватар, имя, роль, крестик; пространство, родитель и дети; статус с таймером хода
 * (или длительностью последнего), очередь; действия — «Прервать», «В архив» / «Вернуть», меню ⋯.
 */
import { useMemo, useState } from 'react'
import { AgentMenu, useAgentActions } from '@/features/agent-actions'
import { AgentAvatar, agentStatusMeta } from '@/entities/agent'
import { RoleBadge, useRole } from '@/entities/role'
import { duration } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { YOU, openAgent, useStore } from '@/shared/model'
import { Icon, IconButton, StatusDot } from '@/shared/ui'
import { formatMs } from '../lib/toolIcon'
import type { HeaderProps } from '../model/types'
import s from './AgentDetail.module.css'

export function DetailHeader({ agent, onClose }: HeaderProps) {
	const role = useRole(agent.role)
	const parent = useStore(st => (agent.parent === YOU ? null : (st.agents.find(a => a.id === agent.parent) ?? null)))
	const agents = useStore(st => st.agents)
	const children = useMemo(() => agents.filter(a => a.parent === agent.id), [agents, agent.id])
	const actions = useAgentActions(agent)
	const [busy, setBusy] = useState<'cancel' | 'archive' | null>(null)
	const working = agent.status === 'working' || agent.status === 'starting'
	const st = agentStatusMeta(agent)
	const waiting = agent.pendingPermissions.length > 0

	const run = async (kind: 'cancel' | 'archive', fn: () => Promise<unknown>): Promise<void> => {
		setBusy(kind)
		try {
			await fn()
		} finally {
			setBusy(null)
		}
	}

	return (
		<header className={s.head}>
			<div className={s.titleRow}>
				<IconButton icon="chevronLeft" label="Назад" size="sm" className={s.back} onClick={onClose} />
				<AgentAvatar name={agent.name} roleHue={role?.color ?? null} size={24} />
				<h2 className={s.name} title={agent.displayName ? `${agent.name} · ${agent.displayName}` : agent.name}>
					{agent.name}
				</h2>
				{role ? <RoleBadge role={role} className={s.role} /> : agent.role && <span className={s.roleGone}>роль удалена</span>}
				<IconButton icon="close" label="Закрыть детали" size="sm" className={s.close} onClick={onClose} />
			</div>
			<div className={s.sub}>
				<span className={s.spaceChip} title={`Пространство ${agent.space}`}>
					{agent.space}
				</span>
				{parent && (
					<span className={s.rel}>
						родитель:{' '}
						<button type="button" className={s.link} onClick={() => openAgent(parent.id)}>
							{parent.name}
						</button>
					</span>
				)}
				{agent.parent === YOU && <span className={s.rel}>поручил: вы</span>}
				{children.length > 0 && (
					<span className={s.rel}>
						{children.length === 1 ? 'ребёнок: ' : 'дети: '}
						{children.map((c, i) => (
							<span key={c.id}>
								{i > 0 && ', '}
								<button type="button" className={s.link} onClick={() => openAgent(c.id)}>
									{c.name}
								</button>
							</span>
						))}
					</span>
				)}
			</div>
			<div className={s.stateRow}>
				<span
					className={[s.pill, waiting ? s.pillWait : agent.status === 'error' ? s.pillErr : working ? s.pillWork : undefined].filter(Boolean).join(' ')}
					title={agent.error ?? st.label}
				>
					{waiting ? <Icon name="alert" size={12} /> : <StatusDot color={st.color} pulse={st.pulse} size={7} />}
					{waiting ? 'ждёт вас' : st.label}
				</span>
				{working && agent.turnStartedAt ? (
					<TurnTimer since={agent.turnStartedAt} />
				) : (
					agent.lastTurnMs !== null && <span className={s.muted}>последний ход {formatMs(agent.lastTurnMs)}</span>
				)}
				{agent.queued > 0 && (
					<span className={s.queue} title={`В очереди: ${agent.queued}`}>
						+{agent.queued}
					</span>
				)}
				<span className={s.grow} />
				{working && !agent.archived && (
					<button
						type="button"
						className={[s.act, s.actStop].join(' ')}
						disabled={busy !== null || actions.busy}
						onClick={() => void run('cancel', actions.cancel)}
						title="Прервать текущий ход"
					>
						{busy === 'cancel' ? <span className={s.spin} /> : <Icon name="stop" size={12} />}
						<span className={s.actLabel}>Прервать</span>
					</button>
				)}
				{agent.archived ? (
					<button type="button" className={s.act} disabled={busy !== null || actions.busy} onClick={() => void run('archive', actions.restore)} title="Вернуть из архива">
						{busy === 'archive' ? <span className={s.spin} /> : <Icon name="restore" size={12} />}
						<span className={s.actLabel}>Вернуть</span>
					</button>
				) : (
					<button
						type="button"
						className={s.act}
						disabled={busy !== null || actions.busy}
						onClick={() => void run('archive', actions.archive)}
						title="Убрать в архив (сессия сохранится)"
					>
						{busy === 'archive' ? <span className={s.spin} /> : <Icon name="archive" size={12} />}
						<span className={s.actLabel}>В архив</span>
					</button>
				)}
				<AgentMenu agent={agent} />
			</div>
		</header>
	)
}

/** Таймер хода — перерисовывается раз в секунду только он. */
function TurnTimer({ since }: { since: string }) {
	const now = useNow(1000)
	return (
		<time className={s.timer} title="Длительность текущего хода">
			{duration(since, now)}
		</time>
	)
}
