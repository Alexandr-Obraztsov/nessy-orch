import { AGENT_STATE_LABEL, StatusIcon, canStop } from '@/entities/agent'
import { roleColor, useRole } from '@/entities/role'
import { StopButton } from '@/features/stop-agent'
import { cssVars } from '@/shared/lib/style'
import { IconButton } from '@/shared/ui'
import type { HeaderProps } from '../model/types'
import s from './AgentDetail.module.css'

/** Шапка панели (липкая): статус, имя, роль · состояние, «Остановить», закрыть. */
export function DetailHeader({ agent, state, onClose }: HeaderProps) {
	const role = useRole(agent.role)
	return (
		<header className={s.head}>
			<StatusIcon state={state} size={22} />
			<div className={s.title}>
				<b>{agent.name}</b>
				<span className={s.sub}>
					<span className={s.roleDot} style={cssVars({ '--rc': role ? roleColor(role.color) : 'var(--gray-7)' })} />
					{role?.name ?? 'без роли'}
					<span aria-hidden="true">·</span>
					<span className={s.stateText} data-state={state}>
						{AGENT_STATE_LABEL[state]}
					</span>
				</span>
			</div>
			{canStop(agent) && <StopButton agentId={agent.id} />}
			<IconButton icon="close" label="Закрыть (Esc)" onClick={onClose} className={s.close} />
		</header>
	)
}
