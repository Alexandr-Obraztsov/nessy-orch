import { cssVars } from '@/shared/lib/style'
import { roleColor } from '../lib/color'
import s from './RoleBadge.module.css'

export interface RoleDotProps {
	hue: number
	size?: number
	title?: string
}

/** Цветная точка роли. */
export function RoleDot({ hue, size = 8, title }: RoleDotProps) {
	return <span className={s.dot} style={cssVars({ '--c': roleColor(hue) }, { width: size, height: size })} title={title} aria-hidden={!title} />
}
