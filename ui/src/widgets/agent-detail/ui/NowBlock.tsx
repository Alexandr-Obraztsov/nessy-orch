/**
 * «Сейчас»: текущий инструмент с живой длительностью, «думает…» / «пишет ответ…», очередь.
 * У свободного агента блок не показывается (кроме очереди): шапка уже говорит «свободен».
 */
import type { ToolEvent } from '@contract'
import { firstLine } from '@/entities/message'
import { useNow } from '@/shared/lib/useNow'
import { Icon } from '@/shared/ui'
import { formatMs, toolIcon } from '../lib/toolIcon'
import type { NowProps } from '../model/types'
import s from './AgentDetail.module.css'

const open = (ev: ToolEvent): boolean => ev.status === 'pending' || ev.status === 'in_progress'

export function NowBlock({ agent, events, live }: NowProps) {
	const working = agent.status === 'working' || agent.status === 'starting'
	if (!working && agent.queued === 0) return null

	// идущий вызов инструмента — последний незавершённый tool в событиях
	let tool: ToolEvent | null = null
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i]
		if (ev?.kind === 'user') break
		if (ev?.kind === 'tool' && open(ev)) {
			tool = ev
			break
		}
	}
	const run = live[live.length - 1]

	return (
		<section className={s.blk} aria-label="Сейчас">
			<div className={s.blkHead}>
				<span>Сейчас</span>
				{agent.queued > 0 && <span className={s.blkCount}>+{agent.queued} в очереди</span>}
			</div>
			{agent.status === 'starting' ? (
				<div className={s.nowRow}>
					<span className={s.spinStart} />
					<span className={s.nowText}>Запуск агента…</span>
				</div>
			) : working ? (
				tool ? (
					<div className={s.nowRow}>
						<span className={s.spinWork} />
						<Icon name={toolIcon(tool.name)} size={13} className={s.nowIcon} />
						<span className={[s.nowText, s.mono].join(' ')} title={tool.title || tool.name}>
							{tool.title || tool.name}
						</span>
						<LiveFor since={tool.ts} />
					</div>
				) : run?.kind === 'text' ? (
					<div className={s.nowRow}>
						<span className={s.spinWork} />
						<span className={s.nowText}>пишет ответ…</span>
					</div>
				) : (
					<div className={s.nowRow}>
						<span className={s.spinWork} />
						<span className={[s.nowText, s.thinking].join(' ')}>думает…</span>
						{run?.kind === 'thought' && <span className={s.nowHint}>{firstLine(run.text.split('\n').slice(-1)[0] ?? '')}</span>}
						{!run && agent.lastTool && <span className={s.nowHint}>после: {agent.lastTool.title}</span>}
					</div>
				)
			) : (
				<div className={s.nowRow}>
					<Icon name="clock" size={13} className={s.nowIcon} />
					<span className={s.nowText}>Свободен, ждёт сообщения из очереди</span>
				</div>
			)}
		</section>
	)
}

/** Живая длительность «0:14» с момента since. */
function LiveFor({ since }: { since: number }) {
	const now = useNow(1000)
	return <span className={s.nowTime}>{formatMs(Math.max(0, now - since))}</span>
}
