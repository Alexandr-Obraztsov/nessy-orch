import { PlanBar, elapsedMs, planProgress, toolLabel, toolStartedAt } from '@/entities/agent'
import { useTaskTitles } from '@/entities/task'
import { plural } from '@/shared/lib/plural'
import { timer } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { YOU, nodeLabel, useStore } from '@/shared/model'
import type { SectionProps } from '../model/types'
import s from './AgentDetail.module.css'

/** Задача, пространство и родитель; прогресс плана, текущий шаг и инструмент с живым таймером. */
export function Progress({ agent, state }: SectionProps) {
	const task = useTaskTitles().get(agent.id) ?? '—'
	const agents = useStore(st => st.agents)
	const live = state === 'working' || state === 'starting' || state === 'wait'
	const now = useNow(live ? 1000 : 60_000)
	const plan = planProgress(agent)
	const ms = elapsedMs(agent, now)
	const tool = state === 'working' && agent.turnSteps > 0 ? agent.lastTool : null
	const t = tool ? toolLabel(tool) : null

	let stepLine = ''
	if (plan) stepLine = plan.step ? `Сейчас: ${plan.step}` : plan.done === plan.total ? 'Все шаги выполнены' : ''
	else if (state === 'idle') stepLine = agent.queued > 0 ? `В очереди сообщений: ${agent.queued}` : 'Ждёт поручения'
	else if (live) stepLine = 'Агент не публиковал план'

	return (
		<>
			<div className={s.sec}>
				<div className={s.task}>{task}</div>
				<div className={s.meta}>
					<span>
						пространство <b>{agent.space}</b>
					</span>
					<span>
						поручил <b>{agent.parent === YOU ? 'оркестратор' : nodeLabel(agents, agent.parent)}</b>
					</span>
					{ms !== null && (
						<span>
							{live ? 'в работе' : 'последний ход'} <b>{timer(ms)}</b>
						</span>
					)}
					{agent.turnSteps > 0 && (
						<span>
							<b>{plural(agent.turnSteps, 'вызов', 'вызова', 'вызовов')}</b> инструментов
						</span>
					)}
				</div>
			</div>
			<div className={s.sec}>
				<h4 className={s.h4}>
					Прогресс <em>{plan ? `${plan.done} из ${plan.total}` : ''}</em>
				</h4>
				<PlanBar entries={agent.plan?.entries ?? null} state={state} size="md" />
				{stepLine && <div className={s.stepLine}>{stepLine}</div>}
				{state === 'working' && (
					<div className={s.now}>
						{t ? (
							<>
								<span className={s.toolName}>{t.name}</span>
								<span className={s.toolArg} title={tool?.title}>
									{t.arg}
								</span>
							</>
						) : (
							<span className={s.toolArg}>думает…</span>
						)}
						<span className={s.nowTimer}>{timer(now - (tool ? toolStartedAt(agent, now) : Date.parse(agent.turnStartedAt ?? agent.lastActivityAt)))}</span>
					</div>
				)}
			</div>
		</>
	)
}
