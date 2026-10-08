/**
 * Граф агентов в духе Obsidian Graph View: простые точки, тонкие серые линии,
 * подписи при приближении, наведение подсвечивает соседей и гасит остальное.
 */
import { useCallback, useMemo, useState } from 'react'
import { roleColor } from '@/entities/role'
import { YOU, openAgent, openDialog, openFeed, useStore } from '@/shared/model'
import { Button, Kbd } from '@/shared/ui'
import { neighborsOf } from '../lib/geometry'
import { useGraphSettings } from '../model/settings'
import type { GNode } from '../model/types'
import { useGraphData } from '../model/useGraphData'
import { useGraphEngine } from '../model/useGraphEngine'
import { GraphControls } from './GraphControls'
import s from './GraphView.module.css'

function fill(n: GNode): string {
	if (n.you) return 'var(--accent)'
	if (n.working) return 'var(--st-working)'
	if (n.error) return 'var(--st-error)'
	if (n.roleHue !== null) return roleColor(n.roleHue)
	return 'var(--graph-node)'
}

export function GraphView() {
	const settings = useGraphSettings()
	const data = useGraphData(settings.showArchived)
	const activate = useCallback((id: string) => (id === YOU ? openFeed() : openAgent(id)), [])
	const engine = useGraphEngine(data, activate)
	const [hover, setHover] = useState<string | null>(null)
	const focus = engine.dragging ?? hover
	const near = useMemo(() => neighborsOf(focus, data.edges), [focus, data.edges])
	const empty = useStore(st => st.agents.length === 0 && st.conn === 'live')

	const cls = [s.svg, focus && s.focus, settings.labels && s.labelsOn, engine.dragging && s.dragging].filter(Boolean).join(' ')

	return (
		<div ref={engine.containerRef} className={s.root}>
			<svg
				ref={engine.svgRef}
				className={cls}
				width={engine.size.w || undefined}
				height={engine.size.h || undefined}
				role="group"
				aria-label="Граф агентов"
			>
				<g ref={engine.worldRef}>
					<g>
						{data.edges.map(e => (
							<line
								key={e.id}
								ref={engine.edgeRef(e.id)}
								className={`${s.edge} ${focus && (e.a === focus || e.b === focus) ? s.edgeOn : ''}`}
							/>
						))}
					</g>
					<g>
						{data.nodes.map(n => (
							<g
								key={n.id}
								ref={engine.nodeRef(n.id)}
								data-node={n.id}
								className={[s.node, near.has(n.id) && s.near, n.archived && s.archived, n.you && s.you].filter(Boolean).join(' ')}
								role="button"
								tabIndex={0}
								aria-label={n.you ? 'Вы — открыть ленту' : `Агент ${n.name}`}
								onPointerEnter={() => setHover(n.id)}
								onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
								onFocus={() => setHover(n.id)}
								onBlur={() => setHover(h => (h === n.id ? null : h))}
								onKeyDown={e => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault()
										activate(n.id)
									}
								}}
							>
								<circle className={s.hit} r={n.r + 6} />
								<circle className={s.dot} r={n.r} style={{ fill: fill(n) }} />
								<text className={s.label} y={n.r} dy="1.25em">
									{n.name}
								</text>
							</g>
						))}
					</g>
				</g>
			</svg>
			<GraphControls archived={data.archived} onFit={engine.fit} onZoom={engine.zoomBy} />
			{empty && (
				<div className={s.empty}>
					<p>Агентов пока нет</p>
					<Button size="sm" variant="secondary" icon="plus" onClick={() => openDialog('spawn')}>
						Новый агент <Kbd>N</Kbd>
					</Button>
				</div>
			)}
		</div>
	)
}
