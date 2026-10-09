/**
 * Окно агента как в Claude Desktop: шапка (статус, имя, роль, задача, «Остановить»), слева — план,
 * справа — чат его действий в стиле Claude Code. Только наблюдение: писать агенту отсюда нельзя.
 */
import { AGENT_STATE_LABEL, PlanList, StatusGlyph, agentState, canStop, useAgentStream } from '@/entities/agent'
import { roleColor, useRole } from '@/entities/role'
import { taskOf, useTask } from '@/entities/task'
import { StopButton } from '@/features/stop-agent'
import { cssVars } from '@/shared/lib/style'
import { openColumn, useStore } from '@/shared/model'
import { IconButton, Sparkle, Window } from '@/shared/ui'
import type { AgentWindowProps, HeaderProps, WindowBodyProps, WindowViewProps } from '../model/types'
import s from './AgentWindow.module.css'
import { Transcript } from './Transcript'

export function AgentWindow({ agentId, onClose }: AgentWindowProps) {
	const name = useStore(st => (agentId ? (st.agents.find(a => a.id === agentId)?.name ?? agentId) : ''))
	return (
		<Window open={agentId !== null} onClose={onClose} label={`Агент ${name}`} className={s.window}>
			{agentId && <Body key={agentId} agentId={agentId} onClose={onClose} />}
		</Window>
	)
}

function Body({ agentId, onClose }: WindowBodyProps) {
	const stream = useAgentStream(agentId)
	const stored = useStore(st => st.agents.find(a => a.id === agentId))
	const conn = useStore(st => st.conn)
	const agent = stored ?? stream.agent
	if (!agent)
		return (
			<div className={s.missing}>
				{conn === 'live' && stream.connected ? <span>Агент не найден</span> : <Sparkle />}
				<IconButton icon="close" label="Закрыть" onClick={onClose} className={s.missingClose} />
			</div>
		)
	return <View agent={agent} stream={stream} onClose={onClose} />
}

function View({ agent, stream, onClose }: WindowViewProps) {
	const state = agentState(agent)
	const entries = agent.plan?.entries ?? []
	const done = entries.filter(e => e.status === 'completed').length
	return (
		<div className={s.layout} data-agent-window={agent.id} data-state={state}>
			<Header agent={agent} state={state} onClose={onClose} />
			<div className={s.main} data-plan={entries.length > 0 || undefined}>
				{entries.length > 0 && (
					<aside className={s.aside} aria-label="План">
						<details className={s.planBox} open>
							<summary className={s.planHead}>
								<span>План</span>
								<span className={s.planCount}>
									{done} из {entries.length}
								</span>
							</summary>
							<PlanList entries={entries} live={state === 'working'} />
						</details>
					</aside>
				)}
				<Transcript agent={agent} stream={stream} />
			</div>
		</div>
	)
}

function Header({ agent, state, onClose }: HeaderProps) {
	const role = useRole(agent.role)
	const taskId = taskOf(agent)
	const task = useTask(taskId ?? '')
	return (
		<header className={s.head}>
			<StatusGlyph state={state} size={18} />
			<div className={s.title}>
				<h2 className={s.name}>{agent.name}</h2>
				<div className={s.sub}>
					{role && (
						<span className={s.role} style={cssVars({ '--rc': roleColor(role.color) })}>
							{role.name}
						</span>
					)}
					<span className={s.state} data-state={state}>
						{AGENT_STATE_LABEL[state]}
					</span>
					{task && (
						<button type="button" className={s.task} onClick={() => openColumn(task.id)} title="Открыть задачу">
							{task.title}
						</button>
					)}
					<span className={s.space}>{agent.space}</span>
				</div>
			</div>
			{canStop(agent) && <StopButton agentId={agent.id} />}
			<IconButton icon="close" label="Закрыть (Esc)" onClick={onClose} />
		</header>
	)
}
