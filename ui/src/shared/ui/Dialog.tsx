/**
 * Модальное окно: на десктопе — по центру, на узких экранах — нижний лист (bottom sheet).
 * Esc и клик по фону закрывают; фокус переносится внутрь.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import s from './Dialog.module.css'
import { IconButton } from './Button'

export interface DialogProps {
	open: boolean
	title: string
	subtitle?: string
	onClose: () => void
	children: ReactNode
	footer?: ReactNode
}

export function Dialog({ open, title, subtitle, onClose, children, footer }: DialogProps) {
	const panel = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		const first = panel.current?.querySelector<HTMLElement>('input, textarea, select')
		first?.focus()
		return () => {
			window.removeEventListener('keydown', onKey)
			prev?.focus()
		}
	}, [open, onClose])

	if (!open) return null
	return createPortal(
		<div className={s.backdrop} onMouseDown={e => e.target === e.currentTarget && onClose()}>
			<div ref={panel} className={s.panel} role="dialog" aria-modal="true" aria-label={title}>
				<div className={s.head}>
					<div className={s.grow}>
						<h2 className={s.title}>{title}</h2>
						{subtitle && <p className={s.subtitle}>{subtitle}</p>}
					</div>
					<IconButton icon="close" label="Закрыть" onClick={onClose} />
				</div>
				<div className={s.body}>{children}</div>
				{footer && <div className={s.foot}>{footer}</div>}
			</div>
		</div>,
		document.body,
	)
}
