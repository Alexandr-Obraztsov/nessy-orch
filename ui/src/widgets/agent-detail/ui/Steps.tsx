import { useMemo, useRef } from 'react'
import { toolLabel } from '@/entities/agent'
import { timer } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { formatMs } from '../lib/format'
import { lastTurn } from '../lib/turn'
import type { Step, StepsProps } from '../model/types'
import { useToolDurations } from '../model/useToolDurations'
import s from './AgentDetail.module.css'

function tone(st: Step): string {
	if (st.kind === 'permission') return st.ev.resolved ? (st.ev.approved ? 'ok' : 'err') : 'wait'
	if (st.running) return 'run'
	return st.ev.status === 'failed' ? 'err' : 'ok'
}

/** Таймлайн шагов текущего (последнего) хода: инструменты и запросы разрешений с длительностями. */
export function Steps({ stream, running }: StepsProps) {
	const now = useNow(running ? 1000 : 60_000)
	const durations = useToolDurations(stream.events, stream.ready)
	const turn = useMemo(() => lastTurn(stream.events, durations, running, now), [stream.events, durations, running, now])
	// новые шаги въезжают, уже бывшие при открытии — нет
	const initial = useRef<Set<string> | null>(null)
	if (initial.current === null && stream.ready) initial.current = new Set(turn?.steps.map(x => x.key))

	const steps = turn?.steps ?? []
	return (
		<section className={s.sec} aria-label="Шаги">
			<h4 className={s.h4}>
				Шаги <em>{turn && steps.length > 0 ? (turn.running ? `ход ${turn.index} · идёт` : `ход ${turn.index} · ${formatMs(turn.end - turn.start)}`) : ''}</em>
			</h4>
			{!stream.ready ? (
				<div className={s.muted}>Загрузка шагов…</div>
			) : steps.length === 0 ? (
				<div className={s.muted}>{running ? 'Инструментов в этом ходе пока не было' : 'Шагов пока нет'}</div>
			) : (
				<ol className={s.tl}>
					{steps.map(st => {
						const label = st.kind === 'tool' ? toolLabel(st.ev) : { name: 'Разрешение', arg: st.ev.title }
						const fresh = initial.current !== null && !initial.current.has(st.key)
						return (
							<li key={st.key} data-tone={tone(st)} className={fresh ? s.enter : undefined}>
								<i aria-hidden="true" />
								<div className={s.l1}>
									<span className={s.toolName}>{label.name}</span>
									<span className={s.toolArg} title={st.kind === 'tool' ? st.ev.title : st.ev.title}>
										{label.arg}
									</span>
									<span className={s.dur}>{st.ms === null ? '' : st.running ? timer(st.ms) : formatMs(st.ms)}</span>
								</div>
								<div className={s.l2}>
									+{timer(st.start - (turn?.start ?? st.start))}
									{st.kind === 'permission' && (st.ev.resolved ? (st.ev.approved ? ' · разрешено' : ' · отклонено') : ' · ждёт решения')}
									{st.kind === 'tool' && st.ev.status === 'failed' && ' · ошибка'}
								</div>
							</li>
						)
					})}
				</ol>
			)}
		</section>
	)
}
