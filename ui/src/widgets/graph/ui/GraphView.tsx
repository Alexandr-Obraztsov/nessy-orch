/**
 * Виджет «Граф агентов» — экран сонара: «Вы» в центре, агенты — отметки вокруг,
 * рёбра — кто кого запустил и кто с кем переписывается, пакеты — живые сообщения.
 */
import { useMedia } from '@/shared/lib/useMedia'
import { useStore, useView } from '@/shared/model'
import { useGraphData } from '../model/useGraphData'
import { useGraphEngine } from '../model/useGraphEngine'
import { ConnBadge } from './ConnBadge'
import { EmptyState } from './EmptyState'
import { GraphScene } from './GraphScene'
import sc from './GraphScene.module.css'
import s from './GraphView.module.css'
import { Legend } from './Legend'
import { NodeTooltip } from './NodeTooltip'
import { SummaryChips } from './SummaryChips'
import { ZoomControls } from './ZoomControls'

const PACKET_CLASSES = {
	packet: sc.packet ?? '',
	trail: sc.packetTrail ?? '',
	glow: sc.packetGlow ?? '',
	core: sc.packetCore ?? '',
	ripple: sc.ripple ?? '',
	msg: sc.msg ?? '',
	reply: sc.reply ?? '',
	failed: sc.failed ?? '',
}

export function GraphView() {
	const reduced = useMedia('(prefers-reduced-motion: reduce)')
	const roomy = useMedia('(min-width: 1100px) and (min-height: 1000px)')
	const data = useGraphData()
	const engine = useGraphEngine({ data, packetClasses: PACKET_CLASSES, motion: !reduced })
	const selected = useView(v => v.selectedAgentId)
	const conn = useStore(s => s.conn)
	const empty = useStore(s => s.agents.length === 0)

	return (
		<div ref={engine.containerRef} className={`${s.root} ${conn === 'offline' ? s.offline : ''}`}>
			<GraphScene data={data} engine={engine} selected={selected} motion={!reduced} />
			<SummaryChips />
			<ConnBadge conn={conn} />
			{empty && conn === 'live' && <EmptyState />}
			{!empty && <Legend defaultOpen={roomy} />}
			<ZoomControls onZoom={engine.zoomBy} onFit={engine.fit} follow={engine.follow} />
			{engine.hover && !engine.dragging && <NodeTooltip id={engine.hover} anchorRef={engine.tooltipRef} />}
		</div>
	)
}
