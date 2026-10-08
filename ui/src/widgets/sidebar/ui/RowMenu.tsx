import { useState, type ReactNode } from 'react'
import { IconButton, Popover } from '@/shared/ui'

export interface RowMenuProps {
	label: string
	open: boolean
	onOpenChange: (v: boolean) => void
	/** пункты меню; close — закрыть меню после действия */
	children: (close: () => void) => ReactNode
}

/** Кнопка «⋯» строки дерева с выпадающим меню. */
export function RowMenu({ label, open, onOpenChange, children }: RowMenuProps) {
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
	const close = (): void => onOpenChange(false)
	return (
		<>
			<IconButton
				ref={setAnchor}
				icon="dots"
				label={label}
				size="sm"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={e => {
					e.stopPropagation()
					onOpenChange(!open)
				}}
			/>
			<Popover open={open} anchor={anchor} onClose={close} align="end" label={label} role="menu">
				{children(close)}
			</Popover>
		</>
	)
}
