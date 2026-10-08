import { useLayoutEffect, type RefObject } from 'react'

/** Высота textarea по содержимому (до max px). */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement>, value: string, max = 168): void {
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, max)}px`
		el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
	}, [ref, value, max])
}
