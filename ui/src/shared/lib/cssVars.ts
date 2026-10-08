import type { CSSProperties } from 'react'

/** CSS-переменные для style без приведения типов: cssVars({ '--h': 200 }). */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
	return vars
}
