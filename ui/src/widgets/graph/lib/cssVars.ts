import type { CSSProperties } from 'react'

/** Inline-стиль с CSS-переменными (React не типизирует `--*`). */
export function cssVars(vars: Record<string, string | number>, base: CSSProperties = {}): CSSProperties {
	const style: CSSProperties = { ...base }
	return Object.assign(style, vars)
}
