/**
 * Автопрокрутка чата вниз, пока пользователь сам не пролистал вверх; тогда — кнопка «К последнему».
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { reducedMotion } from '@/shared/lib/motion'

const NEAR = 80

export function useStickToBottom(ref: RefObject<HTMLElement>, contentKey: unknown, ready: boolean): { away: boolean; toBottom: () => void } {
	const stick = useRef(true)
	const [away, setAway] = useState(false)

	useEffect(() => {
		const el = ref.current
		if (!el) return
		const onScroll = (): void => {
			const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR
			stick.current = near
			setAway(!near)
		}
		el.addEventListener('scroll', onScroll, { passive: true })
		return () => el.removeEventListener('scroll', onScroll)
	}, [ref])

	useLayoutEffect(() => {
		const el = ref.current
		if (el && ready && stick.current) el.scrollTop = el.scrollHeight
	}, [ref, contentKey, ready])

	const toBottom = useCallback(() => {
		const el = ref.current
		if (!el) return
		stick.current = true
		el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' })
	}, [ref])

	return { away, toBottom }
}
