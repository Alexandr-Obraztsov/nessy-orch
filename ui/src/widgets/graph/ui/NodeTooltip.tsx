/**
 * Карточка-подсказка над узлом. Положение якоря обновляет движок графа (transform).
 */
import type { RefCallback } from 'react'
import { AGENT_STATUS, AgentAvatar } from '@/entities/agent'
import { hueColor } from '@/shared/lib/color'
import { ago, duration } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { YOU, spaceHue, useStore } from '@/shared/model'
import { Icon, StatusDot } from '@/shared/ui'
import { cssVars } from '../lib/cssVars'
import o from './Overlays.module.css'

export interface NodeTooltipProps {
	id: string
	anchorRef: RefCallback<HTMLDivElement>
}

export function NodeTooltip({ id, anchorRef }: NodeTooltipProps) {
	const now = useNow(1000)
	const agent = useStore(s => s.agents.find(a => a.id === id))
	const spaces = useStore(s => s.spaces)
	const agentsCount = useStore(s => s.agents.length)
	const sent = useStore(s => s.messages.reduce((n, m) => (m.from === YOU ? n + 1 : n), 0))

	let body
	if (id === YOU) {
		body = (
			<>
				<div className={o.tipHead}>
					<AgentAvatar name="you" you size={30} />
					<div className={o.tipName}>
						<strong>Вы</strong>
						<span className={o.tipId}>оператор · центр сонара</span>
					</div>
				</div>
				<div className={o.tipFoot}>
					<span className={o.tag}>агентов: {agentsCount}</span>
					<span className={o.tag}>отправлено: {sent}</span>
				</div>
			</>
		)
	} else if (agent) {
		const hue = spaceHue(spaces, agent.space)
		const st = AGENT_STATUS[agent.status]
		body = (
			<>
				<div className={o.tipHead}>
					<AgentAvatar name={agent.name} hue={hue} status={agent.status} size={30} />
					<div className={o.tipName}>
						<strong>{agent.name}</strong>
						<span className={o.tipId}>
							{agent.id} · <span className={o.tipSpace}>{agent.space}</span>
						</span>
					</div>
					<span className={o.tipStatus}>
						<StatusDot color={st.color} pulse={st.pulse} size={7} />
						{st.label}
					</span>
				</div>
				{agent.lastTool && (
					<div className={o.tipRow}>
						<Icon name="tool" size={13} />
						<span>{agent.lastTool.title || agent.lastTool.name}</span>
					</div>
				)}
				{agent.error ? (
					<p className={`${o.tipPreview} ${o.tipError}`}>{agent.error}</p>
				) : (
					agent.preview && <p className={o.tipPreview}>{agent.preview}</p>
				)}
				<div className={o.tipFoot}>
					{agent.status === 'working' && agent.turnStartedAt && (
						<span className={`${o.tag} ${o.tagWork}`}>
							<Icon name="clock" size={11} />
							{duration(agent.turnStartedAt, now)}
						</span>
					)}
					{agent.queued > 0 && <span className={`${o.tag} ${o.tagWarn}`}>в очереди: {agent.queued}</span>}
					{agent.pendingPermissions.length > 0 && (
						<span className={`${o.tag} ${o.tagWarn}`}>
							<Icon name="shield" size={11} />
							разрешений: {agent.pendingPermissions.length}
						</span>
					)}
					<span className={o.tag}>активность: {ago(agent.lastActivityAt, now)}</span>
				</div>
			</>
		)
	} else return null

	const hue = agent ? spaceHue(spaces, agent.space) : 160
	return (
		<div ref={anchorRef} className={o.tipAnchor} aria-hidden="true">
			<div className={o.tip} style={cssVars({ '--h': hueColor(hue) })}>
				{body}
			</div>
		</div>
	)
}
