import type { SectionProps } from '../model/types'
import s from './AgentDetail.module.css'

const MARK = { completed: 'сделано', in_progress: 'в работе', pending: 'впереди' } as const

/** План-чеклист: сделанный шаг — галочка дорисовывается, текущий — пульсирующая точка. */
export function Plan({ agent, state }: SectionProps) {
	const entries = agent.plan?.entries ?? []
	if (entries.length === 0) return null
	const done = entries.filter(e => e.status === 'completed').length
	return (
		<section className={s.sec} aria-label="План">
			<h4 className={s.h4}>
				План <em>{`${done} из ${entries.length}`}</em>
			</h4>
			<ol className={s.plan} data-state={state}>
				{entries.map((e, i) => (
					<li key={i} data-s={e.status}>
						<svg viewBox="0 0 18 18" role="img" aria-label={MARK[e.status]}>
							<circle className={s.cir} cx="9" cy="9" r="7.5" />
							<circle className={s.core} cx="9" cy="9" r="3" />
							<path className={s.tick} d="M5.4 9.3l2.4 2.4 4.6-5" />
						</svg>
						<span>{e.content}</span>
					</li>
				))}
			</ol>
		</section>
	)
}
