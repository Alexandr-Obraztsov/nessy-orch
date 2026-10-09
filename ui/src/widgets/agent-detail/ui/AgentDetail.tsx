/**
 * Панель деталей агента (справа; на телефоне — нижний лист): шапка с «Остановить»,
 * запрос разрешения / ошибка, задача, прогресс, итоговый ответ с источниками, план-чеклист,
 * таймлайн шагов текущего хода и свёрнутая переписка (только чтение).
 */
import { agentState, useAgentStream } from '@/entities/agent'
import { useStore } from '@/shared/model'
import { IconButton } from '@/shared/ui'
import type { AgentDetailProps, DetailViewProps } from '../model/types'
import { useResultText } from '../model/useResultText'
import s from './AgentDetail.module.css'
import { Alert } from './Alert'
import { Chat } from './Chat'
import { DetailHeader } from './DetailHeader'
import { Plan } from './Plan'
import { Progress } from './Progress'
import { Result } from './Result'
import { Steps } from './Steps'

export function AgentDetail({ agentId, onClose }: AgentDetailProps) {
	// key — при смене агента сбрасываем всё локальное (прокрутка, раскрытия, поток)
	return <DetailRoot key={agentId} agentId={agentId} onClose={onClose} />
}

function DetailRoot({ agentId, onClose }: AgentDetailProps) {
	const stream = useAgentStream(agentId)
	const stored = useStore(st => st.agents.find(a => a.id === agentId))
	const conn = useStore(st => st.conn)
	const agent = stored ?? (conn === 'live' ? null : stream.agent)
	if (!agent)
		return (
			<div className={s.missing}>
				<span>{conn === 'live' ? `Агента ${agentId} больше нет.` : 'Загрузка…'}</span>
				<IconButton icon="close" label="Закрыть (Esc)" onClick={onClose} />
			</div>
		)
	return <Detail agent={agent} stream={stream} onClose={onClose} />
}

function Detail({ agent, stream, onClose }: DetailViewProps) {
	const state = agentState(agent)
	const text = useResultText(agent, stream.events)
	const running = agent.status === 'working' || agent.status === 'starting'
	return (
		<section className={s.detail} aria-label={`Детали агента ${agent.name}`} data-agent-detail={agent.id}>
			<DetailHeader agent={agent} state={state} onClose={onClose} />
			<Alert agent={agent} state={state} />
			<Progress agent={agent} state={state} />
			<Result agent={agent} text={text} />
			<Plan agent={agent} state={state} />
			<Steps stream={stream} running={running} />
			<Chat agent={agent} events={stream.events} ready={stream.ready} />
		</section>
	)
}
