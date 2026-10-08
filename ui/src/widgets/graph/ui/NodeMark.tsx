/**
 * Отметка узла на экране сонара. Координаты не задаёт — их пишет движок графа (transform).
 */
import { type KeyboardEvent, type RefCallback, memo } from 'react'
import { AGENT_STATUS, initials } from '@/entities/agent'
import { hueColor } from '@/shared/lib/color'
import { cssVars } from '@/shared/lib/style'
import { AGENT_R, YOU_R } from '../model/useSimulation'
import type { NodeDatum } from '../model/types'
import s from './GraphScene.module.css'

export interface NodeMarkProps {
	node: NodeDatum
	selected: boolean
	dimmed: boolean
	nodeRef: RefCallback<SVGGElement>
	onHover: (id: string | null) => void
	onActivate: (id: string) => void
}

/** id градиента-ореола для оттенка пространства (градиенты объявлены в сцене) */
export const haloId = (hue: number): string => `graph-halo-${Math.round(hue)}`

const cx = (...c: (string | false | undefined)[]): string => c.filter(Boolean).join(' ')

export const NodeMark = memo(function NodeMark({ node, selected, dimmed, nodeRef, onHover, onActivate }: NodeMarkProps) {
	const r = node.you ? YOU_R : AGENT_R
	const st = node.status ? AGENT_STATUS[node.status] : null
	const style = cssVars({
		'--h': hueColor(node.hue),
		'--h-soft': hueColor(node.hue, 0.16),
		'--h-text': `hsl(${Math.round(node.hue)} 75% 68%)`,
		'--st': st?.color ?? 'var(--accent)',
	})
	const label = node.you ? 'Вы (оператор): показать общую ленту' : `${node.name}, ${st?.label ?? ''} — открыть чат`
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			onActivate(node.id)
		}
	}
	const status = node.status ?? 'idle'
	const ringR = r + 4.5
	return (
		<g
			ref={nodeRef}
			data-node={node.id}
			className={cx(s.node, node.you && s.you, s[status], node.leaving && s.leaving, selected && s.sel, dimmed && s.dim)}
			style={style}
			tabIndex={node.leaving ? -1 : 0}
			role="button"
			aria-label={label}
			aria-pressed={node.you ? undefined : selected}
			onKeyDown={onKey}
			onPointerEnter={e => e.pointerType !== 'touch' && onHover(node.id)}
			onPointerLeave={() => onHover(null)}
			onFocus={() => onHover(node.id)}
			onBlur={() => onHover(null)}
		>
			<g className={s.body}>
				<circle className={s.halo} r={r + 22} fill={node.you ? 'url(#graph-you-halo)' : `url(#${haloId(node.hue)})`} />
				{node.you ? (
					<>
						<circle className={s.youBeacon} r={r} />
						<circle className={s.disc} r={r} />
						<circle className={s.fill} r={r} />
						<circle className={s.youRing} r={r - 7} />
						<circle className={s.youCore} r={4.5} />
					</>
				) : (
					<>
						{st?.pulse && <circle className={s.pulse} r={r} />}
						<circle className={s.disc} r={r} />
						<circle className={s.fill} r={r} />
						<circle
							className={cx(
								s.statusRing,
								status === 'working' && s.spin,
								status === 'starting' && s.spinSlow,
							)}
							r={ringR}
							style={{ opacity: status === 'idle' ? 0.5 : status === 'dead' ? 0 : 1 }}
						/>
						<text className={s.initials}>{initials(node.name)}</text>
					</>
				)}
				<circle className={s.focusRing} r={r + 9} />
				{node.perms > 0 && (
					<g className={cx(s.badge, s.badgePerm)} transform={`translate(${-r * 0.78} ${-r * 0.78})`}>
						<circle className={s.badgePing} r={7.5} />
						<circle className={s.badgeDot} r={7.5} />
						<text>!</text>
					</g>
				)}
				{node.queued > 0 && (
					<g className={cx(s.badge, s.badgeQueued)} transform={`translate(${r * 0.82} ${-r * 0.82})`}>
						<circle r={node.queued > 9 ? 9 : 7.5} />
						<text>{node.queued > 99 ? '99+' : node.queued}</text>
					</g>
				)}
				<text className={s.label} y={r + 17}>
					{node.name.length > 18 ? `${node.name.slice(0, 16)}…` : node.name}
				</text>
				{!node.you && (
					<text className={s.meta} y={r + 30}>
						{node.id} · {node.space}
					</text>
				)}
			</g>
		</g>
	)
})
