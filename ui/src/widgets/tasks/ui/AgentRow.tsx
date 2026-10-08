/**
 * Строка агента (32 px): иконка состояния, имя и роль, текущее действие, мини-план, шаги,
 * «+N в очереди», таймер хода (желтеет, если давно нет событий). Клик / Enter — детали.
 */
import { memo } from 'react'
import { StatusIcon, currentAction, isActiveState, isStale, planCount } from '@/entities/agent'
import { RoleChip } from '@/entities/role'
import { cssVars } from '@/shared/lib/style'
import { openAgent, useStore } from '@/shared/model'
import { Elapsed, NoTimer } from '@/shared/ui'
import type { AgentRowProps } from '../model/types'
import s from './Tasks.module.css'

export const AgentRow = memo(function AgentRow({ row, selected, flat }: AgentRowProps) {
	const { agent: a, state } = row
	const role = useStore(st => (a.role ? st.roles.find(r => r.id === a.role) : undefined))
	const act = currentAction(a)
	const plan = planCount(a)
	const depth = flat ? 0 : Math.min(row.depth, 3)
	const active = isActiveState(state)

	let tm
	if (active && a.turnStartedAt) tm = <Elapsed from={Date.parse(a.turnStartedAt)} stale={now => isStale(a, now)} className={s.rowTm} />
	else if (!active && a.lastTurnMs !== null) tm = <Elapsed from={0} to={a.lastTurnMs} className={s.rowTm} title="Длительность последнего хода" />
	else tm = <NoTimer className={s.rowTm} />

	return (
		<div
			className={[s.row, depth > 0 && s.child, selected && s.sel].filter(Boolean).join(' ')}
			style={depth > 1 ? cssVars({ '--indent': `${depth * 14}px` }) : undefined}
			role="button"
			tabIndex={0}
			data-row={a.id}
			aria-current={selected || undefined}
			aria-label={`${a.name}: ${act.text}`}
			onClick={() => openAgent(a.id)}
			onKeyDown={e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					openAgent(a.id)
				}
			}}
		>
			<StatusIcon state={state} className={s.rowIc} />
			<div className={s.who}>
				<span className={s.name} title={a.name}>
					{a.name}
				</span>
				{role && <RoleChip name={role.name} hue={role.color} />}
			</div>
			<span className={`${s.act} ${s[`act_${act.tone}`] ?? ''}`} title={act.text}>
				{act.text}
			</span>
			<div className={s.meta}>
				{plan && a.plan && (
					<span className={s.mp} title={`План: ${plan.done} из ${plan.total}`}>
						<span className={s.segs} aria-hidden="true">
							{a.plan.entries.slice(0, 10).map((e, i) => (
								<i key={i} className={e.status === 'completed' ? s.segDone : e.status === 'in_progress' ? s.segActive : undefined} />
							))}
						</span>
						{plan.done}/{plan.total}
					</span>
				)}
				{a.queued > 0 && (
					<span className={s.qb} title="Сообщений в очереди">
						+{a.queued}
					</span>
				)}
				{a.turnSteps > 0 && (
					<span className={s.stp} title="Вызовов инструментов в ходе">
						{a.turnSteps} шаг.
					</span>
				)}
			</div>
			{tm}
		</div>
	)
})
