/**
 * Окно поверх страницы, как в Claude Desktop: по центру, скруглённое, подложка затемнена с размытием;
 * появляется fade + scale .97→1 с небольшим подъёмом и так же уходит. На узком экране — лист снизу.
 * Esc, клик мимо и крестик (в содержимом) закрывают; фокус удерживается внутри и возвращается после.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { reducedMotion } from '@/shared/lib/motion'
import s from './Window.module.css'

export interface WindowProps {
	open: boolean
	onClose: () => void
	/** подпись окна для экранных читалок */
	label: string
	children: ReactNode
	className?: string
}

const EXIT_MS = 170
const FOCUSABLE = 'a[href], button:not([disabled]), input, textarea, select, summary, [tabindex]:not([tabindex="-1"])'

export function Window({ open, onClose, label, children, className }: WindowProps) {
	const [mounted, setMounted] = useState(open)
	const [closing, setClosing] = useState(false)
	const panel = useRef<HTMLDivElement>(null)
	const closeRef = useRef(onClose)
	closeRef.current = onClose
	// содержимое на время ухода — последнее показанное
	const last = useRef(children)
	if (open) last.current = children

	useEffect(() => {
		if (open) {
			setMounted(true)
			setClosing(false)
			return
		}
		if (!mounted) return
		setClosing(true)
		const t = window.setTimeout(
			() => {
				setMounted(false)
				setClosing(false)
			},
			reducedMotion() ? 0 : EXIT_MS,
		)
		return () => window.clearTimeout(t)
	}, [open, mounted])

	useEffect(() => {
		if (!mounted) return
		const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
		panel.current?.focus({ preventScroll: true })
		const onKey = (e: KeyboardEvent): void => {
			const root = panel.current
			if (!root) return
			if (e.key === 'Escape' && !e.defaultPrevented) {
				e.preventDefault()
				closeRef.current()
				return
			}
			if (e.key !== 'Tab') return
			const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null)
			const first = items[0]
			const lastEl = items[items.length - 1]
			if (!first || !lastEl) {
				e.preventDefault()
				return
			}
			const active = document.activeElement
			if (e.shiftKey && (active === first || active === root)) {
				e.preventDefault()
				lastEl.focus()
			} else if (!e.shiftKey && active === lastEl) {
				e.preventDefault()
				first.focus()
			} else if (!(active instanceof Node) || !root.contains(active)) {
				e.preventDefault()
				first.focus()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('keydown', onKey)
			if (prev?.isConnected) prev.focus({ preventScroll: true })
		}
	}, [mounted])

	if (!mounted) return null
	return createPortal(
		<div className={s.root} data-closing={closing || undefined}>
			<div className={s.scrim} onMouseDown={() => closeRef.current()} aria-hidden="true" />
			<div ref={panel} className={[s.panel, className].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
				{open ? children : last.current}
			</div>
		</div>,
		document.body,
	)
}
