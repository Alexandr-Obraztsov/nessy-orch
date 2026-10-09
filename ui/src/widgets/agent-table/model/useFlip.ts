/**
 * FLIP-анимация строк таблицы: когда порядок или группы строк меняются (агент переехал из
 * «Работают» в «Выполнено», запрос разрешения поднял строку наверх), каждая строка плавно едет
 * со старого места на новое, а новые строки проявляются. Позиции — относительно содержимого
 * прокручиваемого контейнера, поэтому прокрутка не мешает. При prefers-reduced-motion — без анимаций.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { reducedMotion } from '@/shared/lib/motion'

const MOVE_MS = 420
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

function measure(root: HTMLElement): Map<string, number> {
	const base = root.getBoundingClientRect().top - root.scrollTop
	const out = new Map<string, number>()
	for (const el of root.querySelectorAll<HTMLElement>('[data-row]')) {
		const id = el.dataset['row']
		if (id) out.set(id, el.getBoundingClientRect().top - base)
	}
	return out
}

/**
 * @param orderKey  меняется при смене порядка/групп строк — тогда анимируем
 * @param layoutKey меняется при сворачивании групп и фильтрах — тогда только перемеряем после перехода
 */
export function useFlip(ref: RefObject<HTMLElement>, orderKey: string, layoutKey: string): void {
	const pos = useRef<Map<string, number> | null>(null)
	const lastOrder = useRef(orderKey)
	const lastLayout = useRef(layoutKey)

	useLayoutEffect(() => {
		const root = ref.current
		if (!root) return
		const next = measure(root)
		const prev = pos.current
		const reorder = lastOrder.current !== orderKey
		const relayout = lastLayout.current !== layoutKey
		lastOrder.current = orderKey
		lastLayout.current = layoutKey
		pos.current = next
		if (relayout) {
			// группа сворачивается/разворачивается — позиции станут верными после её перехода
			const t = window.setTimeout(() => {
				if (ref.current) pos.current = measure(ref.current)
			}, 420)
			return () => window.clearTimeout(t)
		}
		if (!prev || !reorder || reducedMotion()) return
		for (const el of root.querySelectorAll<HTMLElement>('[data-row]')) {
			const id = el.dataset['row'] ?? ''
			const top = next.get(id)
			const was = prev.get(id)
			if (top === undefined) continue
			if (was === undefined) {
				el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE })
				continue
			}
			const dy = was - top
			if (Math.abs(dy) < 1) continue
			el.animate([{ transform: `translateY(${dy}px)`, zIndex: 2 }, { transform: 'none', zIndex: 2 }], { duration: MOVE_MS, easing: EASE })
		}
		return undefined
	}, [ref, orderKey, layoutKey])

	// ширина окна меняет высоту строк (телефон: две строки) — перемеряем
	useEffect(() => {
		const onResize = (): void => {
			if (ref.current) pos.current = measure(ref.current)
		}
		window.addEventListener('resize', onResize)
		return () => window.removeEventListener('resize', onResize)
	}, [ref])
}
