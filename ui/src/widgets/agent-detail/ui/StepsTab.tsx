/** «Шаги»: мини-таймлайн текущего (последнего) хода и список вызовов — 26px строки, раскрываются по клику. */
import { useRef, useState } from 'react'
import type { StepsTabProps } from '../model/types'
import s from './Steps.module.css'
import { PermissionRow } from './PermissionRow'
import { StepsTimeline } from './StepsTimeline'
import t from './Timeline.module.css'
import { ToolRow } from './ToolRow'

const plural = (n: number): string => {
	const m10 = n % 10
	const m100 = n % 100
	if (m10 === 1 && m100 !== 11) return 'вызов'
	if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'вызова'
	return 'вызовов'
}

export function StepsTab({ agent, turn }: StepsTabProps) {
	const [picked, setPicked] = useState<{ key: string; n: number }>({ key: '', n: 0 })
	const list = useRef<HTMLDivElement>(null)
	const working = agent.status === 'working' || agent.status === 'starting'

	if (!turn || turn.steps.length === 0)
		return <div className={s.empty}>{working ? 'Агент ещё не вызывал инструментов в этом ходе.' : 'Шагов пока нет.'}</div>

	const tools = turn.steps.filter(x => x.kind === 'tool').length
	const pick = (key: string): void => {
		setPicked(p => ({ key, n: p.n + 1 }))
		const st = turn.steps.find(x => x.key === key)
		const sel = st?.kind === 'tool' ? `[data-tool="${CSS.escape(st.ev.toolId)}"]` : st ? `[data-perm="${CSS.escape(st.ev.requestId)}"]` : null
		if (sel) window.requestAnimationFrame(() => list.current?.querySelector(sel)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
	}

	return (
		<div className={s.steps}>
			<div className={s.head}>
				<span>
					Ход {turn.index} · {tools} {plural(tools)}
				</span>
				{turn.running && <span className={s.live}>идёт</span>}
			</div>
			<StepsTimeline turn={turn} onPick={pick} />
			<div className={t.timeline} ref={list}>
				{turn.steps.map((st, i) =>
					st.kind === 'tool' ? (
						<ToolRow key={st.key} ev={st.ev} durationMs={st.ms} n={i + 1} forceOpen={picked.key === st.key ? picked.n : 0} />
					) : (
						<PermissionRow key={st.key} ev={st.ev} agent={agent} durationMs={st.ms} buttons={false} />
					),
				)}
			</div>
		</div>
	)
}
