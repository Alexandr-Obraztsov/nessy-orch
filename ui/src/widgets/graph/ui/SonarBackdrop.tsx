/**
 * Фон «экрана сонара» в мировых координатах: сетка, концентрические кольца с дальностями,
 * пеленги через 30° и медленная развёртка (луч) вокруг «Вы».
 */
import { memo } from 'react'
import s from './GraphScene.module.css'

const RINGS = [100, 200, 300, 400, 500, 600, 800, 1000, 1200]
const EXTENT = 1400
const GRID = 50
const SWEEP_SLICES = 14
const SWEEP_DEG = 3.2

function wedge(r: number, a0: number, a1: number): string {
	const p = (a: number): string => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`
	return `M0 0L${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}Z`
}

export const SonarBackdrop = memo(function SonarBackdrop({ sweep }: { sweep: boolean }) {
	const bearings = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6)
	const rad = Math.PI / 180
	return (
		<g aria-hidden="true">
			<defs>
				<pattern id="graph-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse" x={-GRID / 2} y={-GRID / 2}>
					<path className={s.gridLine} d={`M${GRID} 0H0V${GRID}`} />
				</pattern>
				<radialGradient id="graph-sweep" cx="0" cy="0" r="900" gradientUnits="userSpaceOnUse">
					<stop offset="0" className={s.sweepStop0} />
					<stop offset="1" className={s.sweepStop1} />
				</radialGradient>
				<linearGradient id="graph-sweep-line" x1="0" y1="0" x2="900" y2="0" gradientUnits="userSpaceOnUse">
					<stop offset="0" className={s.sweepStop0} style={{ stopOpacity: 0.5 }} />
					<stop offset="1" className={s.sweepStop1} />
				</linearGradient>
			</defs>
			<rect x={-EXTENT * 2} y={-EXTENT * 2} width={EXTENT * 4} height={EXTENT * 4} fill="url(#graph-grid)" />
			{bearings.map(a => (
				<line
					key={a}
					className={s.bearing}
					x1={Math.cos(a) * 40}
					y1={Math.sin(a) * 40}
					x2={Math.cos(a) * EXTENT}
					y2={Math.sin(a) * EXTENT}
				/>
			))}
			{RINGS.map(r => (
				<g key={r}>
					<circle className={`${s.ring} ${r % 200 === 0 ? s.ringMajor : ''}`} r={r} />
					<text className={s.tick} x={4} y={-r - 4}>
						{r}
					</text>
				</g>
			))}
			{sweep && (
				<g>
					<g className={s.sweep}>
						{Array.from({ length: SWEEP_SLICES }, (_, i) => (
							<path
								key={i}
								d={wedge(EXTENT, -(i + 1) * SWEEP_DEG * rad, -i * SWEEP_DEG * rad)}
								fill="url(#graph-sweep)"
								fillOpacity={((SWEEP_SLICES - i) / SWEEP_SLICES) ** 1.6}
							/>
						))}
						<line className={s.sweepLine} x1={0} y1={0} x2={EXTENT} y2={0} />
					</g>
				</g>
			)}
		</g>
	)
})
