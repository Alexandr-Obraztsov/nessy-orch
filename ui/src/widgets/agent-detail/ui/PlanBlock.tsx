/** «План»: прогресс «3 из 5» с полосой и чек-лист (✓ сделано, ◐ в работе, ○ впереди). */
import { ago } from '@/shared/lib/time'
import { cssVars } from '@/shared/lib/style'
import { Icon } from '@/shared/ui'
import type { PlanProps } from '../model/types'
import s from './AgentDetail.module.css'

const SOURCE = { cli: 'сообщил агент', acp: 'из протокола nessy' } as const

function updated(ts: string): string {
	const a = ago(ts)
	return a === 'сейчас' ? 'только что' : `${a} назад`
}

export function PlanBlock({ agent }: PlanProps) {
	const plan = agent.plan
	if (!plan || plan.entries.length === 0) return null
	const done = plan.entries.filter(e => e.status === 'completed').length
	const total = plan.entries.length
	const working = agent.status === 'working' || agent.status === 'starting'
	return (
		<section className={s.blk} aria-label="План">
			<div className={s.blkHead}>
				<span>План</span>
				<span className={s.blkCount}>
					{done} из {total}
				</span>
			</div>
			<div
				className={s.pbar}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={total}
				aria-valuenow={done}
				aria-label={`Выполнено ${done} из ${total}`}
				style={cssVars({ '--p': `${Math.round((done / total) * 100)}%` })}
			>
				<i />
			</div>
			<ol className={s.plan}>
				{plan.entries.map((e, i) => (
					<li key={i} className={s[`plan_${e.status}`]}>
						<span className={s.planIcon} aria-label={e.status === 'completed' ? 'сделано' : e.status === 'in_progress' ? 'в работе' : 'впереди'}>
							{e.status === 'completed' ? (
								<Icon name="check" size={12} />
							) : e.status === 'in_progress' ? (
								<span className={working ? s.spinWork : s.halfDot} />
							) : (
								<span className={s.ring} />
							)}
						</span>
						<span className={s.planText}>{e.content}</span>
					</li>
				))}
			</ol>
			<div className={s.planSrc}>
				{SOURCE[plan.source]} · обновлён {updated(plan.updatedAt)}
			</div>
		</section>
	)
}
