import { cssVars } from '../lib/style'
import s from './StatusDot.module.css'

export interface StatusDotProps {
	color: string
	pulse?: boolean
	size?: number
	title?: string
}

export function StatusDot({ color, pulse, size = 8, title }: StatusDotProps) {
	const style = cssVars({ '--c': color }, { width: size, height: size })
	return <span className={[s.dot, pulse && s.pulse].filter(Boolean).join(' ')} style={style} title={title} />
}
