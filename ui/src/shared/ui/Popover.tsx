/**
 * Всплывающее меню, привязанное к элементу-якорю. Рендерится в body (position: fixed),
 * прижимается к краям окна; закрывается кликом снаружи, Esc и при ресайзе.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import s from './Popover.module.css'

export interface PopoverProps {
	open: boolean
	anchor: HTMLElement | null
	onClose: () => void
	/** выравнивание по левому или правому краю якоря */
	align?: 'start' | 'end'
	label: string
	className?: string
	children: ReactNode
}

const GAP = 6
const EDGE = 8

export function Popover({ open, anchor, onClose, align = 'start', label, className, children }: PopoverProps) {
	const ref = useRef<HTMLDivElement>(null)
	const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })

	useLayoutEffect(() => {
		if (!open || !anchor) return
		const place = (): void => {
			const el = ref.current
			if (!el) return
			const r = anchor.getBoundingClientRect()
			const w = el.offsetWidth
			const h = el.offsetHeight
			let left = align === 'end' ? r.right - w : r.left
			left = Math.max(EDGE, Math.min(left, window.innerWidth - w - EDGE))
			let top = r.bottom + GAP
			// не влезает вниз — открываем вверх
			if (top + h > window.innerHeight - EDGE && r.top - GAP - h > EDGE) top = r.top - GAP - h
			setPos({ left, top, maxHeight: window.innerHeight - top - EDGE })
		}
		place()
		const ro = new ResizeObserver(place)
		if (ref.current) ro.observe(ref.current)
		window.addEventListener('resize', place)
		return () => {
			ro.disconnect()
			window.removeEventListener('resize', place)
		}
	}, [open, anchor, align])

	useEffect(() => {
		if (!open) return
		const onDown = (e: PointerEvent): void => {
			const t = e.target as Node
			if (ref.current?.contains(t) || anchor?.contains(t)) return
			onClose()
		}
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.stopPropagation()
				onClose()
				anchor?.focus()
			}
		}
		document.addEventListener('pointerdown', onDown, true)
		window.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('pointerdown', onDown, true)
			window.removeEventListener('keydown', onKey)
		}
	}, [open, anchor, onClose])

	useEffect(() => {
		if (!open) setPos({ visibility: 'hidden' })
	}, [open])

	if (!open || !anchor) return null
	return createPortal(
		<div ref={ref} className={[s.pop, className].filter(Boolean).join(' ')} style={pos} role="dialog" aria-label={label}>
			{children}
		</div>,
		document.body,
	)
}
