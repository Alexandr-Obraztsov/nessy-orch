/**
 * Ребро графа. Геометрию (атрибут d у всех path внутри) пишет движок графа.
 */
import { type RefCallback, memo } from 'react'
import { cssVars } from '@/shared/lib/style'
import { edgeWidth } from '../lib/edgeStyle'
import type { EdgeDatum } from '../model/types'
import s from './GraphScene.module.css'

export interface EdgeMarkProps {
	edge: EdgeDatum
	/** «тепло» свежей переписки 0..1 (квантованное, чтобы не перерисовывать зря) */
	heat: number
	hl: boolean
	dimmed: boolean
	edgeRef: RefCallback<SVGGElement>
}

export const EdgeMark = memo(function EdgeMark({ edge, heat, hl, dimmed, edgeRef }: EdgeMarkProps) {
	const cls = [s.edge, s.enter, edge.kind === 'parent' ? s.parent : s.comm, edge.lastFailed && s.edgeFailed, hl && s.hl, dimmed && s.dim]
		.filter(Boolean)
		.join(' ')
	if (edge.kind === 'parent') {
		return (
			<g ref={edgeRef} className={cls}>
				<path />
			</g>
		)
	}
	const style = cssVars({ '--w': `${edgeWidth(edge.count).toFixed(2)}px`, '--heat': heat })
	return (
		<g ref={edgeRef} className={cls} style={style}>
			<title>{`${edge.count} сообщ.`}</title>
			<path className={s.commGlow} />
			<path className={s.commBase} />
		</g>
	)
})
