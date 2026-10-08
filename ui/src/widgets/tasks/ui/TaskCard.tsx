/**
 * Карточка поручения: заголовок, сводный статус, общее время; прогресс-бар — только когда есть
 * знаменатель (план корня или число агентов), иначе пульс работы и «шагов: N». Внутри — строки агентов.
 */
import { memo } from 'react'
import { StatusIcon } from '@/entities/agent'
import { TASK_STATUS_ICON, TASK_STATUS_LABEL, agentsText, progressText } from '@/entities/task'
import { toggleCollapsed } from '@/shared/model'
import { Elapsed, Icon } from '@/shared/ui'
import type { TaskCardProps } from '../model/types'
import { AgentRow } from './AgentRow'
import s from './Tasks.module.css'

export const TaskCard = memo(function TaskCard({ task: t, open, selectedId }: TaskCardProps) {
	const p = t.progress
	const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
	return (
		<article className={[s.card, s[`card_${t.status}`], open && s.open].filter(Boolean).join(' ')} data-task={t.id}>
			<button type="button" className={s.cardH} aria-expanded={open} onClick={() => toggleCollapsed(t.id)}>
				<Icon name="chevronRight" size={16} className={s.chev} />
				<span className={s.title} title={t.title}>
					{t.title}
				</span>
				<span className={s.right}>
					<span className={`${s.pill} ${s[`pill_${t.status}`]}`}>
						<StatusIcon state={TASK_STATUS_ICON[t.status]} size={12} />
						{TASK_STATUS_LABEL[t.status]}
					</span>
					<Elapsed from={t.startedAt} to={t.endedAt} className={s.total} title="Общее время поручения" />
				</span>
				<span className={s.tMeta}>
					{p ? (
						<>
							<span
								className={`${s.bar} ${s[`bar_${t.status}`]}`}
								role="progressbar"
								aria-valuenow={p.done}
								aria-valuemin={0}
								aria-valuemax={p.total}
								aria-label={progressText(p)}
							>
								<i style={{ width: `${pct}%` }} />
							</span>
							<span>{progressText(p)}</span>
						</>
					) : (
						<>
							{t.status === 'working' && <span className={s.pulseDot} aria-hidden="true" />}
							<span>шагов: {t.steps}</span>
						</>
					)}
					<span aria-hidden="true">·</span>
					<span>{agentsText(t.agents.length)}</span>
					<span className={s.spChip}>{t.space}</span>
					{!open && t.status === 'done' && t.result && <span className={s.tPrev}>· «{t.result}»</span>}
				</span>
			</button>
			{open && (
				<div className={s.rows}>
					{t.agents.map(r => (
						<AgentRow key={r.agent.id} row={r} selected={selectedId === r.agent.id} />
					))}
				</div>
			)}
		</article>
	)
})
