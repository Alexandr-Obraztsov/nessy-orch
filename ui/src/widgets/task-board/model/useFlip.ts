/**
 * FLIP-анимация карточек: когда порядок меняется (агент запросил разрешение и поднялся, закончил
 * и ушёл в «Выполнено»), каждая карточка плавно едет со старого места на новое (по x и y).
 * Позиции — относительно контейнера. При prefers-reduced-motion — без анимаций.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { reducedMotion } from '@/shared/lib/motion'

const MOVE_MS = 320
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

type Pos = Map<string, { x: number; y: number }>

function measure(root: HTMLElement): Pos {
	const base = root.getBoundingClientRect()
	const out: Pos = new Map()
	for (const el of root.querySelectorAll<HTMLElement>('[data-card]')) {
		const id = el.dataset['card']
		if (!id) continue
		const r = el.getBoundingClientRect()
		out.set(id, { x: r.left - base.left, y: r.top - base.top + root.scrollTop })
	}
	return out
}

export function useFlip(ref: RefObject<HTMLElement>, orderKey: string): void {
	const pos = useRef<Pos | null>(null)
	const last = useRef(orderKey)
	useLayoutEffect(() => {
		const root = ref.current
		if (!root) return
		const next = measure(root)
		const prev = pos.current
		const changed = last.current !== orderKey
		last.current = orderKey
		pos.current = next
		if (!prev || !changed || reducedMotion()) return
		for (const el of root.querySelectorAll<HTMLElement>('[data-card]')) {
			const id = el.dataset['card'] ?? ''
			const now = next.get(id)
			const was = prev.get(id)
			if (!now || !was) continue
			const dx = was.x - now.x
			const dy = was.y - now.y
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
			el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: EASE })
		}
	})
}
