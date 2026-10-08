/**
 * Ореол пространства: дуга вокруг его агентов с подписью. Дугу пересчитывает движок графа.
 */
import { type RefCallback, memo } from 'react'
import { cssVars } from '../lib/cssVars'
import { hueColor } from '@/shared/lib/color'
import type { SectorDatum } from '../model/types'
import s from './GraphScene.module.css'

export interface SectorMarkProps {
	sector: SectorDatum
	count: number
	dimmed: boolean
	sectorRef: RefCallback<SVGGElement>
}

export const SectorMark = memo(function SectorMark({ sector, count, dimmed, sectorRef }: SectorMarkProps) {
	const id = `graph-sector-${sector.space.replace(/[^\w-]/g, '_')}`
	return (
		<g
			ref={sectorRef}
			className={`${s.sector} ${s.enter}`}
			style={cssVars({ '--h': hueColor(sector.hue) }, { opacity: dimmed ? 0.4 : 1 })}
			aria-hidden="true"
		>
			<path className={s.sectorBand} />
			<path className={s.sectorArc} />
			<path className={s.sectorLabelPath} id={id} />
			<text className={s.sectorLabel}>
				<textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
					{sector.space} · {count}
				</textPath>
			</text>
		</g>
	)
})
