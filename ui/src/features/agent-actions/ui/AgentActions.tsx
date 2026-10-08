/**
 * Действия в шапке чата агента: «Прервать» (пока идёт ход) и меню «⋯».
 */
import { IconButton } from '@/shared/ui'
import type { AgentActionsProps } from '../model/types'
import { useAgentActions } from '../model/useAgentActions'
import s from './AgentActions.module.css'
import { AgentMenu } from './AgentMenu'

export function AgentActions({ agent }: AgentActionsProps) {
	const act = useAgentActions(agent)
	return (
		<div className={s.actions}>
			{act.cancellable && (
				<IconButton icon="stop" label="Прервать ход" size="sm" className={s.stop} loading={act.busy} onClick={() => void act.cancel()} />
			)}
			<AgentMenu agent={agent} />
		</div>
	)
}
