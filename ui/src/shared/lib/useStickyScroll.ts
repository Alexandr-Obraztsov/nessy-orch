/**
 * «Липкая» прокрутка чата: держит низ, пока пользователь внизу; если он отлистал вверх —
 * считает новые элементы (для кнопки «↓ N новых»). Следит и за ростом контента
 * (стриминг текста, раскрытие карточек) через ResizeObserver.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { StickyScroll } from './useStickyScroll.types'

/** насколько близко к низу считается «внизу», px */
const THRESHOLD = 56

export function useStickyScroll(count: number, resetKey?: unknown): StickyScroll {
	const scrollRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const stick = useRef(true)
	// пока идёт плавная прокрутка к низу, промежуточные scroll-события не «отлипают»
	const gliding = useRef(0)
	const prevCount = useRef(count)
	const [atBottom, setAtBottom] = useState(true)
	const [unseen, setUnseen] = useState(0)

	const jump = useCallback((): void => {
		const el = scrollRef.current
		if (el) el.scrollTop = el.scrollHeight
	}, [])

	const onScroll = useCallback((): void => {
		const el = scrollRef.current
		if (!el) return
		const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD
		if (!bottom && Date.now() < gliding.current) return
		stick.current = bottom
		setAtBottom(bottom)
		if (bottom) setUnseen(0)
	}, [])

	const scrollToBottom = useCallback((smooth = true): void => {
		const el = scrollRef.current
		if (!el) return
		stick.current = true
		setAtBottom(true)
		setUnseen(0)
		if (smooth) {
			gliding.current = Date.now() + 700
			el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
		} else el.scrollTop = el.scrollHeight
	}, [])

	// смена ленты/агента — снова внизу
	useLayoutEffect(() => {
		stick.current = true
		setAtBottom(true)
		setUnseen(0)
		prevCount.current = count
		jump()
	}, [resetKey, jump])

	useLayoutEffect(() => {
		const delta = count - prevCount.current
		prevCount.current = count
		if (stick.current) jump()
		else if (delta > 0) setUnseen(u => u + delta)
	}, [count, jump])

	useEffect(() => {
		const content = contentRef.current
		if (!content || typeof ResizeObserver === 'undefined') return
		const ro = new ResizeObserver(() => {
			if (stick.current) jump()
		})
		ro.observe(content)
		return () => ro.disconnect()
	}, [jump])

	return { scrollRef, contentRef, atBottom, unseen, onScroll, scrollToBottom }
}
