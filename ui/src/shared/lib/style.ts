import type { CSSProperties } from 'react'

/** Inline-стиль с CSS-переменными: cssVars({ '--hue': 210 }). */
export function cssVars(vars: Record<string, string | number>, base?: CSSProperties): CSSProperties {
	const style: CSSProperties = { ...base }
	Object.assign(style, vars)
	return style
}
