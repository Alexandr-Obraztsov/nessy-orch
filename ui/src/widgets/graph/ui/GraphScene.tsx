/**
 * SVG-сцена графа: фон сонара, секторы пространств, рёбра, узлы и слой пакетов.
 * Позиции элементов обновляет движок (useGraphEngine) напрямую в DOM.
 */
import { useCallback, useMemo } from 'react'
import { hueColor } from '@/shared/lib/color'
import { useNow } from '@/shared/lib/useNow'
import { YOU, closeAgent, openAgent } from '@/shared/model'
import { cssVars } from '@/shared/lib/style'
import { edgeHeat } from '../lib/edgeStyle'
import { neighborsOf } from '../lib/neighbors'
import type { GraphData } from '../model/useGraphData'
import type { GraphEngine } from '../model/useGraphEngine'
import { EdgeMark } from './EdgeMark'
import s from './GraphScene.module.css'
import { NodeMark, haloId } from './NodeMark'
import { SectorMark } from './SectorMark'
import { SonarBackdrop } from './SonarBackdrop'

export interface GraphSceneProps {
	data: GraphData
	engine: GraphEngine
	selected: string | null
	motion: boolean
}

export function GraphScene({ data, engine, selected, motion }: GraphSceneProps) {
	const now = useNow(3000)
	const focus = selected && data.nodes.some(n => n.id === selected) ? selected : null
	const near = useMemo(() => neighborsOf(focus, data.edges), [focus, data.edges])

	const hues = useMemo(() => [...new Set(data.nodes.filter(n => !n.you).map(n => Math.round(n.hue)))], [data.nodes])
	const perSpace = useMemo(() => {
		const m = new Map<string, number>()
		for (const n of data.nodes) if (n.space && !n.leaving) m.set(n.space, (m.get(n.space) ?? 0) + 1)
		return m
	}, [data.nodes])

	const activate = useCallback((id: string) => (id === YOU ? closeAgent() : openAgent(id)), [])

	// parent-рёбра — под переписку; в каждом слое — по порядку данных
	const parents = data.edges.filter(e => e.kind === 'parent')
	const comms = data.edges.filter(e => e.kind === 'comm')
	const edgeEl = (e: (typeof data.edges)[number]) => {
		const touches = focus !== null && (e.a === focus || e.b === focus)
		return (
			<EdgeMark
				key={e.id}
				edge={e}
				heat={Math.round(edgeHeat(e, now) * 20) / 20}
				hl={touches}
				dimmed={focus !== null && !touches}
				edgeRef={engine.edgeRef(e.id)}
			/>
		)
	}

	return (
		<svg
			ref={engine.svgRef}
			className={`${s.svg} ${engine.dragging ? s.dragging : ''}`}
			width={engine.size.w || undefined}
			height={engine.size.h || undefined}
			role="group"
			aria-label="Граф агентов: перетаскивайте фон для сдвига, колесо или щипок — масштаб"
		>
			<defs>
				<radialGradient id="graph-you-halo" style={cssVars({ '--h': 'var(--accent)' })}>
					<stop offset="0.3" className={s.haloStop0} style={{ stopOpacity: 0.55 }} />
					<stop offset="1" className={s.haloStop1} />
				</radialGradient>
				<radialGradient id="graph-halo-err" style={cssVars({ '--h': 'var(--st-error)' })}>
					<stop offset="0.35" className={s.haloStop0} />
					<stop offset="1" className={s.haloStop1} />
				</radialGradient>
				{hues.map(h => (
					<radialGradient key={h} id={haloId(h)} style={cssVars({ '--h': hueColor(h) })}>
						<stop offset="0.35" className={s.haloStop0} />
						<stop offset="1" className={s.haloStop1} />
					</radialGradient>
				))}
			</defs>
			<g ref={engine.worldRef}>
				<SonarBackdrop sweep={motion} />
				<g>
					{data.sectors.map(sec => (
						<SectorMark
							key={sec.space}
							sector={sec}
							count={perSpace.get(sec.space) ?? 0}
							dimmed={focus !== null && focus !== YOU && !data.nodes.some(n => n.id === focus && n.space === sec.space)}
							sectorRef={engine.sectorRef(sec.space)}
						/>
					))}
				</g>
				<g>{parents.map(edgeEl)}</g>
				<g>{comms.map(edgeEl)}</g>
				<g ref={engine.packetsRef} />
				<g>
					{data.nodes.map(n => (
						<NodeMark
							key={n.id}
							node={n}
							selected={n.id === focus}
							dimmed={focus !== null && !near.has(n.id) && !n.you}
							nodeRef={engine.nodeRef(n.id)}
							onHover={engine.setHover}
							onActivate={activate}
						/>
					))}
				</g>
			</g>
		</svg>
	)
}
