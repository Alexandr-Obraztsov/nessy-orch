import { useCallback, useEffect, useState } from 'react'
import type { CollapseState } from '../model/types'

/** Измеряет высоту блока и решает, нужно ли его сворачивать. */
export function useCollapse(limit: number): CollapseState {
	const [el, setEl] = useState<HTMLDivElement | null>(null)
	const [overflow, setOverflow] = useState(false)
	const [expanded, setExpanded] = useState(false)

	useEffect(() => {
		if (!el || limit <= 0) return
		const measure = (): void => setOverflow(el.scrollHeight > limit + 48)
		measure()
		if (typeof ResizeObserver === 'undefined') return
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		return () => ro.disconnect()
	}, [el, limit])

	const toggle = useCallback(() => setExpanded(v => !v), [])
	return { ref: setEl, overflow, expanded, toggle }
}
