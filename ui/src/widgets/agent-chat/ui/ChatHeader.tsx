import { AgentActions } from '@/features/agent-actions'
import { AGENT_STATUS, AgentAvatar } from '@/entities/agent'
import { hueColor } from '@/shared/lib/color'
import { cssVars } from '@/shared/lib/style'
import { duration } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { closeAgent, spaceHue, useStore } from '@/shared/model'
import { Icon, IconButton, StatusDot } from '@/shared/ui'
import { toolIcon } from '../lib/toolIcon'
import type { ChatHeaderProps } from '../model/types'
import s from './AgentChat.module.css'

/** Шапка чата: назад, аватар, имя, пространство, статус с таймером хода и текущим инструментом, действия. */
export function ChatHeader({ agent }: ChatHeaderProps) {
	const hue = useStore(st => spaceHue(st.spaces, agent.space))
	const now = useNow(1000)
	const st = AGENT_STATUS[agent.status]
	const working = agent.status === 'working'
	return (
		<header className={s.header}>
			<IconButton icon="chevronLeft" label="К общей ленте" size="sm" onClick={closeAgent} className={s.back} />
			<AgentAvatar name={agent.name} hue={hue} status={agent.status} size={36} />
			<div className={s.info}>
				<div className={s.line1}>
					<h2 className={s.name} title={agent.displayName ?? agent.name}>
						{agent.name}
					</h2>
					<span className={s.space} style={cssVars({ '--sc': hueColor(hue), '--sb': hueColor(hue, 0.14) })} title={`Пространство ${agent.space}`}>
						{agent.space}
					</span>
				</div>
				<div className={s.line2} title={agent.error ?? undefined}>
					<StatusDot color={st.color} pulse={st.pulse} size={7} />
					<span className={s.status} style={{ color: st.color }}>
						{st.label}
					</span>
					{working && agent.turnStartedAt && (
						<time className={s.timer}>{duration(agent.turnStartedAt, now)}</time>
					)}
					{working && agent.lastTool && (
						<span className={s.tool} title={agent.lastTool.title}>
							<Icon name={toolIcon(agent.lastTool.name)} size={12} className={s.toolIcon} />
							<span className={s.toolText}>{agent.lastTool.title}</span>
						</span>
					)}
					{agent.status === 'error' && agent.error && <span className={s.err}>{agent.error}</span>}
					{agent.queued > 0 && <span className={s.queued}>в очереди {agent.queued}</span>}
				</div>
			</div>
			<AgentActions agent={agent} />
		</header>
	)
}
