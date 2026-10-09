/**
 * Компактная карточка агента для поповера: имя, роль, таймер; поручение одной строкой; мини-план —
 * прогресс точками и текст текущего шага; последняя команда; запрос разрешения с «Разрешить / Отклонить»
 * прямо здесь; у ошибки — текст, у выполненного — начало итога. Клик — агент в главном окне.
 */
import { memo, type KeyboardEvent, type MouseEvent } from 'react'
import type { AgentView, PlanEntry } from '@contract'
import { AGENT_STATE_LABEL, StatusGlyph, ToolLine, agentState, elapsedMs, resultSummary, toolView } from '@/entities/agent'
import { roleColor, useRole } from '@/entities/role'
import { PermissionButtons } from '@/features/permission'
import { cssVars } from '@/shared/lib/style'
import { timer } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { Shimmer, Sparkle } from '@/shared/ui'
import type { MiniCardProps } from '../model/types'
import s from './MiniCard.module.css'

/** больше шагов точками не рисуем — вместо них тонкая полоса прогресса */
const MAX_DOTS = 14

const onControl = (t: EventTarget): boolean => t instanceof Element && t.closest('button, a') !== null

export const MiniCard = memo(function MiniCard({ agent, brief, index, onOpen }: MiniCardProps) {
	const state = agentState(agent)
	const role = useRole(agent.role)
	const live = state === 'working' || state === 'starting' || state === 'wait'
	const now = useNow(live ? 1000 : 60_000)
	const ms = elapsedMs(agent, now)
	const entries = agent.plan?.entries ?? []
	const perm = agent.pendingPermissions[0]

	const click = (e: MouseEvent): void => {
		if (onControl(e.target)) return
		onOpen(agent)
	}
	const key = (e: KeyboardEvent<HTMLElement>): void => {
		if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
			e.preventDefault()
			onOpen(agent)
		}
	}

	return (
		<article
			className={s.card}
			data-card={agent.id}
			data-state={state}
			tabIndex={0}
			aria-label={`${agent.name}, ${AGENT_STATE_LABEL[state]}`}
			style={cssVars({ '--i': Math.min(index, 10) })}
			onClick={click}
			onKeyDown={key}
		>
			<div className={s.head}>
				<StatusGlyph state={state} size={14} />
				<span className={s.name}>{agent.name}</span>
				{role && (
					<span className={s.role} style={cssVars({ '--rc': roleColor(role.color) })}>
						{role.name}
					</span>
				)}
				<span className={s.sp} />
				<span className={s.timer}>{ms !== null ? timer(ms) : ''}</span>
			</div>

			{brief && <div className={s.brief}>{brief.replace(/\s*\n\s*/g, ' ')}</div>}

			{entries.length > 0 && state !== 'done' && <MiniPlan entries={entries} live={state === 'working'} />}

			{state === 'wait' && perm && (
				<div className={s.ask} role="group" aria-label={`${agent.name}: запрос разрешения`}>
					<code className={s.askCmd}>{perm.title}</code>
					<div className={s.askActs}>
						<PermissionButtons key={perm.requestId} agentId={agent.id} requestId={perm.requestId} />
						{agent.pendingPermissions.length > 1 && <span className={s.more}>ещё {agent.pendingPermissions.length - 1}</span>}
					</div>
				</div>
			)}
			{(state === 'working' || state === 'starting') && <Now agent={agent} />}
			{state === 'error' && <div className={s.error}>{agent.error ?? agent.lastReply?.failed ?? 'Ход завершился ошибкой'}</div>}
			{state === 'done' && resultSummary(agent) && <div className={s.result}>{resultSummary(agent)}</div>}
		</article>
	)
})

/** Прогресс точками: сделанные — заполнены, текущая — акцент с пульсом; рядом — текст текущего шага. */
function MiniPlan({ entries, live }: { entries: PlanEntry[]; live: boolean }) {
	const done = entries.filter(e => e.status === 'completed').length
	const cur = entries.find(e => e.status === 'in_progress') ?? entries.find(e => e.status === 'pending')
	return (
		<div className={s.plan} aria-label={`План: ${done} из ${entries.length}`}>
			{entries.length <= MAX_DOTS ? (
				<span className={s.dots} aria-hidden="true">
					{entries.map((e, i) => (
						<i key={i} className={s.dot} data-s={e.status} data-live={live || undefined} />
					))}
				</span>
			) : (
				<span className={s.bar} aria-hidden="true">
					<i style={{ width: `${Math.round((done / entries.length) * 100)}%` }} />
				</span>
			)}
			<span className={s.step}>{cur ? cur.content : 'План выполнен'}</span>
			<span className={s.count}>
				{done}/{entries.length}
			</span>
		</div>
	)
}

function Now({ agent }: { agent: AgentView }) {
	const tool = agent.turnSteps > 0 ? agent.lastTool : null
	if (agent.status === 'starting' || !tool)
		return (
			<div className={s.now}>
				<Sparkle tone={agent.status === 'starting' ? 'dim' : 'accent'} />
				<Shimmer>{agent.status === 'starting' ? 'Запускается…' : 'Думает…'}</Shimmer>
			</div>
		)
	return (
		<div className={s.cmd}>
			<ToolLine tool={toolView(tool)} tone="run" />
		</div>
	)
}
