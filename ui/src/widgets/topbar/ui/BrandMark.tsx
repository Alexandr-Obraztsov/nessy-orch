import { useId } from 'react'
import s from './BrandMark.module.css'

/** Логотип-сонар: кольца, бегущий луч и вспыхивающая отметка. */
export function BrandMark({ size = 28 }: { size?: number }) {
	const id = useId().replace(/:/g, '')
	return (
		<svg className={s.mark} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
			<defs>
				<linearGradient id={`sw${id}`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="currentColor" stopOpacity="0" />
					<stop offset="1" stopColor="currentColor" stopOpacity="0.55" />
				</linearGradient>
			</defs>
			<circle cx="16" cy="16" r="14.5" className={s.ring} />
			<circle cx="16" cy="16" r="9.5" className={s.ring} opacity="0.7" />
			<circle cx="16" cy="16" r="4.5" className={s.ring} opacity="0.5" />
			<g className={s.sweep}>
				<path d="M16 16 L16 1.5 A14.5 14.5 0 0 1 28.56 8.75 Z" fill={`url(#sw${id})`} />
				<line x1="16" y1="16" x2="28.56" y2="8.75" className={s.beam} />
			</g>
			<circle cx="22.5" cy="20.5" r="2.1" className={s.blip} />
			<circle cx="16" cy="16" r="1.6" className={s.core} />
		</svg>
	)
}
