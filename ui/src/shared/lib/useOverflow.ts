import { useLayoutEffect, useState, type RefObject } from 'react'

/** Содержимое не помещается по высоте (для плавного затухания обрезанного текста). */
export function useOverflow(ref: RefObject<HTMLElement>, dep: unknown): boolean {
	const [over, setOver] = useState(false)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const check = (): void => setOver(el.scrollHeight - el.clientHeight > 2)
		check()
		const ro = new ResizeObserver(check)
		ro.observe(el)
		return () => ro.disconnect()
	}, [ref, dep])
	return over
}
